import { describeElement, pushDebugLog, installDebugApi } from './debug-logger.js';
import { generateChallenge } from './challenge-engine.js';
import { judgeAnswer } from './synonym-judge.js';
import { ensureLoaded as ensureVocabLoaded } from './difficulty.js';
import { highlightParagraph, buildWordCardHtml, countCandidates } from './text-highlighter.js';
import { lookup as dictLookup } from './dict-lookup.js';
import { sm2Success, sm2Fail } from './sm2.js';
import { addFavorite, isFavorite, removeFavorite } from './favorites.js';
import { ICON_AUDIO, ICON_FAV_EMPTY, ICON_FAV_FILLED } from './icons.js';

function speakWordTTS(word, lang) {
    if (!word || typeof window.speechSynthesis === 'undefined') return;
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(String(word));
    utterance.lang = (lang === 'zh') ? 'zh-CN' : 'en-US';
    utterance.rate = 0.85;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
}

function playAudioChain(apiUrl, ttsWord, ttsLang) {
    if (apiUrl) {
        try {
            var audio = new Audio(apiUrl);
            audio.volume = 0.85;
            audio.play().catch(function () { speakWordTTS(ttsWord, ttsLang); });
        } catch (_) { speakWordTTS(ttsWord, ttsLang); }
    } else {
        speakWordTTS(ttsWord, ttsLang);
    }
}

const sessions = new Map();
const managedMessageIds = new Set();

var streamState = {
    active: false,
    lastTickAt: 0
};

var activeMessageId = -1;
var dockRenderKey = '';
var chatContextId = 0;
var generationChatId = 0;

function getContext() {
    return SillyTavern.getContext();
}

function resolveMessageId(data) {
    if (typeof data === 'number') return data;
    if (typeof data === 'string' && /^[0-9]+$/.test(data)) return Number(data);
    if (data && typeof data === 'object') {
        if (typeof data.messageId === 'number') return data.messageId;
        if (typeof data.mesId === 'number') return data.mesId;
        if (typeof data.id === 'number') return data.id;
        if (typeof data.index === 'number') return data.index;
    }
    var context = getContext();
    return (context.chat || []).length - 1;
}

function findLatestBotMessageId() {
    var context = getContext();
    var chat = context.chat || [];
    for (var i = chat.length - 1; i >= 0; i -= 1) {
        var msg = chat[i];
        if (msg && !msg.is_user) return i;
    }
    return -1;
}

function pickActiveMessageId() {
    if (sessions.has(activeMessageId)) {
        var s0 = sessions.get(activeMessageId);
        if (s0 && !isComplete(s0)) return activeMessageId;
    }

    var keys = Array.from(sessions.keys()).sort(function (a, b) { return b - a; });
    for (var i = 0; i < keys.length; i += 1) {
        var id = keys[i];
        var s = sessions.get(id);
        if (s && !isComplete(s)) {
            activeMessageId = id;
            return id;
        }
    }

    activeMessageId = -1;
    return -1;
}

function escapeHtml(input) {
    var s = String(input);
    s = s.replace(/&/g, '&amp;');
    s = s.replace(/</g, '&lt;');
    s = s.replace(/>/g, '&gt;');
    s = s.replace(/"/g, '&quot;');
    s = s.split("'").join('&#39;');
    return s;
}

function normalizeAnswer(input) {
    var s = String(input).toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        var isNum = c >= 48 && c <= 57;
        var isLower = c >= 97 && c <= 122;
        var isCjk = c >= 0x4e00 && c <= 0x9fff;
        if (isNum || isLower || isCjk) out += s.charAt(i);
    }
    return out;
}

function hasCjk(input) {
    var s = String(input || '');
    for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c >= 0x4e00 && c <= 0x9fff) return true;
    }
    return false;
}

function splitAnswerCandidatesFromText(answerText) {
    var s = String(answerText || '').trim();
    if (!s) return [];
    return s.split(/[，,、;；|/\n]|(?:\s+or\s+)|(?:\s+OR\s+)|(?:或者)|(?:或)/).map(function (x) {
        return String(x || '').trim();
    }).filter(function (x) {
        return x.length > 0;
    });
}

function getAcceptedAnswers(challenge) {
    var list = [];
    if (challenge && Array.isArray(challenge.acceptableAnswers)) {
        list = list.concat(challenge.acceptableAnswers);
    }
    if (challenge && typeof challenge.answer === 'string') {
        list.push(challenge.answer);
        list = list.concat(splitAnswerCandidatesFromText(challenge.answer));
    }

    var out = [];
    var seen = new Set();
    for (var i = 0; i < list.length; i += 1) {
        var raw = String(list[i] || '').trim();
        if (!raw) continue;
        var key = normalizeAnswer(raw);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(raw);
    }
    return out;
}

function pickFirstEnglishToken(input) {
    var parts = String(input || '').split(/[，,、;；|/\s]+/).map(function (x) {
        return String(x || '').trim();
    }).filter(function (x) {
        return x.length > 0;
    });

    for (var i = 0; i < parts.length; i += 1) {
        if (/^[a-zA-Z][a-zA-Z'-]*$/.test(parts[i])) return parts[i];
    }

    return parts.length > 0 ? parts[0] : '';
}

function getChallengeAudioWord(challenge) {
    if (!challenge) return '';

    var type = String(challenge.type || '');
    var question = String(challenge.question || '');
    var answer = String(challenge.answer || '');

    if (type === 'en_to_cn') {
        var mEn = question.match(/[：:]\s*(.+)$/);
        if (mEn && mEn[1]) return pickFirstEnglishToken(mEn[1]);
        return pickFirstEnglishToken(answer);
    }

    if (type === 'cn_to_en') {
        return pickFirstEnglishToken(answer);
    }

    return pickFirstEnglishToken(answer);
}

function isAnswerCorrect(userAnswer, challenge) {
    var userNorm = normalizeAnswer(userAnswer);
    if (!userNorm) return false;

    var accepted = getAcceptedAnswers(challenge);
    if (accepted.length === 0) return false;

    for (var i = 0; i < accepted.length; i += 1) {
        var candNorm = normalizeAnswer(accepted[i]);
        if (!candNorm) continue;
        if (userNorm === candNorm) return true;
    }

    if (hasCjk(userNorm) && userNorm.length >= 2) {
        for (var j = 0; j < accepted.length; j += 1) {
            var cjkNorm = normalizeAnswer(accepted[j]);
            if (!cjkNorm) continue;
            if (cjkNorm.indexOf(userNorm) >= 0 || userNorm.indexOf(cjkNorm) >= 0) return true;
        }
    }

    return false;
}

function splitNaturalParagraphs(text) {
    var raw = String(text || '').replace(/\r\n/g, '\n');

    var byBlankLine = raw.split(/\n\s*\n+/).map(function (s) {
        return String(s || '').trim();
    }).filter(function (s) {
        return s.length > 0;
    });
    if (byBlankLine.length >= 2) return byBlankLine;

    var byLine = raw.split(/\n+/).map(function (s) {
        return String(s || '').trim();
    }).filter(function (s) {
        return s.length > 0;
    });
    if (byLine.length >= 2) return byLine;

    var sentenceMatches = raw.match(/[^。！？!?\.]+[。！？!?\.]?/g);
    if (!sentenceMatches || sentenceMatches.length === 0) {
        var fallback = raw.trim();
        return fallback ? [fallback] : [];
    }

    var merged = [];
    var buffer = '';
    for (var i = 0; i < sentenceMatches.length; i += 1) {
        var part = String(sentenceMatches[i] || '').trim();
        if (!part) continue;
        buffer += part;
        if (buffer.length >= 70) {
            merged.push(buffer);
            buffer = '';
        }
    }
    if (buffer) merged.push(buffer);

    if (merged.length === 0) {
        var one = raw.trim();
        return one ? [one] : [];
    }

    return merged;
}

function cleanupDisplayText(rawText) {
    var s = String(rawText || '');

    // 空字节 & 占位符
    s = s.split('\u0000').join('');
    s = s.replace(/NC_PH_\d+_\d+/g, '');

    // ===== 移除整块结构（含内容） =====
    // <thinking>...</thinking>
    s = s.replace(/<\s*thinking\b[^>]*>[\s\S]*?<\s*\/\s*thinking\s*>/gi, '');
    // <meow_FM>...</meow_FM>
    s = s.replace(/<\s*meow_FM\b[^>]*>[\s\S]*?<\s*\/\s*meow_FM\s*>/gi, '');
    // <profile>...</profile>
    s = s.replace(/<\s*profile\b[^>]*>[\s\S]*?<\s*\/\s*profile\s*>/gi, '');
    // <branches>...</branches>
    s = s.replace(/<\s*branches\b[^>]*>[\s\S]*?<\s*\/\s*branches\s*>/gi, '');
    // [[WORLD]]...[[/WORLD]]
    s = s.replace(/\[\[WORLD\]\][\s\S]*?\[\[\/WORLD\]\]/g, '');

    // ===== 移除所有 HTML 注释（包括 draft / confirm / ECoT 等） =====
    s = s.replace(/<!--[\s\S]*?-->/g, '');

    // ===== 移除自定义标签（仅标签本身，不含内容） =====
    // <DH_xxx> <FH_xxx>
    s = s.replace(/<\/?DH_[^>]*>/g, '');
    s = s.replace(/<\/?FH_[^>]*>/g, '');
    // <content> </content>
    s = s.replace(/<\s*\/?\s*content\b[^>]*>/gi, '');

    // ===== 用户自定义忽略正则 =====
    try {
        var context = SillyTavern.getContext();
        var extSettings = context.extensionSettings && context.extensionSettings.extension_learnlock_mvp;
        var rawLines = String((extSettings && extSettings.ignoreRegexLines) || '');
        if (rawLines.trim()) {
            var regexLines = rawLines.split('\n');
            for (var ri = 0; ri < regexLines.length; ri++) {
                var pattern = regexLines[ri].trim();
                if (!pattern) continue;
                try {
                    var userRe = new RegExp(pattern, 'gs');
                    s = s.replace(userRe, '');
                } catch (_reErr) {
                    // 用户正则语法错误，跳过
                }
            }
        }
    } catch (_) {}

    // ===== 换行规范化 =====
    s = s.replace(/\r\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');

    return s.trim();
}

function shouldLockMessage(msg, settings) {
    if (!settings || !settings.enabled) return false;
    if (!msg) return false;
    if (msg.is_user) return false;
    if (typeof msg.mes !== 'string') return false;
    return true;
}

function getUnlockParagraphCount(settings) {
    var n = Number(settings && settings.unlockParagraphsPerQuestion);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(50, Math.floor(n)));
}

   function getHighlightLimit(settings) {
       var value = Number(settings && settings.maxWordCardsPerMessage);
       if (!Number.isFinite(value) || value <= 0) return 0;
       return Math.max(1, Math.min(300, Math.floor(value)));
   }

   function createHighlightState(limit, totalCandidates) {
       if (!limit || limit <= 0) return null;
       if (!totalCandidates || totalCandidates <= limit) return null;
       var indices = [];
       for (var i = 0; i < totalCandidates; i++) indices.push(i);
       for (var fi = indices.length - 1; fi > 0; fi--) {
           var fj = Math.floor(Math.random() * (fi + 1));
           var tmp = indices[fi];
           indices[fi] = indices[fj];
           indices[fj] = tmp;
       }
       var selectedSet = {};
       for (var si = 0; si < limit && si < indices.length; si++) {
           selectedSet[indices[si]] = true;
       }
       return {
           limit: limit,
           globalIndex: 0,
           selectedSet: selectedSet
       };
   }

function buildFallbackChallenge() {
    var diffMod = window.__learnlockDifficultyModule;
    if (diffMod && diffMod.pickRandomByDifficulty) {
        var entry = diffMod.pickRandomByDifficulty('en', 'intermediate');
        if (entry && entry.t && entry.t.length > 0) {
            return {
                type: 'en_to_cn',
                question: '把这个英文词翻译成中文：' + String(entry.w),
                answer: entry.t[0],
                acceptableAnswers: (entry.t.slice(1) || []).concat(entry.a || []),
                source: 'random',
                vocabEntry: entry
            };
        }
    }
    return null;
}

function getHiddenParagraphCount(session) {
    return Math.max(0, Number(session.paragraphs.length || 0) - Number(session.revealedParagraphs || 0));
}

function getVisibleParagraphs(session) {
    var n = Math.max(0, Math.min(Number(session.revealedParagraphs || 0), Number(session.paragraphs.length || 0)));
    if (n <= 0) return [];
    return session.paragraphs.slice(0, n);
}

function isComplete(session) {
    var noHidden = getHiddenParagraphCount(session) <= 0;
    var hasParagraphs = session.paragraphs.length > 0;
    // 非流式状态下，所有段落已解锁即视为完成（兜底 finished 标志未及时设置的情况）
    if (noHidden && hasParagraphs && !streamState.active) return true;
    return Boolean(session.finished) && noHidden;
}

function refreshChallenge(session, settings) {
    var hidden = getHiddenParagraphCount(session);
    if (hidden <= 0) {
        session.currentChallenge = null;
        session.wrongCount = 0;
        session.challengeLoading = false;
        return;
    }
    if (!session.currentChallenge && !session.challengeLoading) {
        // 先放一个 fallback 防止空白
        session.currentChallenge = buildFallbackChallenge();
        session.wrongCount = 0;

        // 异步用引擎出题替换
        if (settings) {
            session.challengeLoading = true;
            generateChallenge(session.displayText || '', settings, session.askedWords || []).then(function (challenge) {
                session.challengeLoading = false;
                if (challenge && !isComplete(session)) {
                    session.currentChallenge = challenge;
                    session.renderKey = '';
                    session.streamKey = '';
                    // 触发重渲染
                    renderSession(session.messageId, settings);
                    renderDock(settings, true);
                }
            }).catch(function (err) {
                session.challengeLoading = false;
                console.warn('[LearnLock] 引擎出题失败，保留 fallback:', err);
            });
        }
    }
}

function markManagedMessageId(messageId) {
    managedMessageIds.add(Number(messageId));
}

function isManagedMessageId(messageId) {
    return managedMessageIds.has(Number(messageId));
}

function ensureSession(messageId, settings) {
    var context = getContext();
    var chat = context.chat || [];
    var msg = chat[messageId];
    if (!msg) return null;
    if (msg.is_user) return null;
    if (!sessions.has(messageId) && !isManagedMessageId(messageId)) return null;

    var currentRaw = String(msg.mes || '');
    var displayText = cleanupDisplayText(currentRaw);
    if (!sessions.has(messageId) && displayText.length < 1) return null;

    var session = sessions.get(messageId);
    if (!session) {
        var paragraphsNew = splitNaturalParagraphs(displayText);
        session = {
            messageId: messageId,
            fullTextRaw: currentRaw,
            displayText: displayText,
            paragraphs: paragraphsNew,
            revealedParagraphs: 0,
            finished: false,
            wrongCount: 0,
            currentChallenge: null,
            renderKey: '',
            streamKey: '',
            solvedWords: [],
            askedWords: [],
            questionsAnswered: 0
        };
        sessions.set(messageId, session);
    } else {
        var prevRaw = String(session.fullTextRaw || '');
        var wasComplete = isComplete(session);
        var rawChanged = currentRaw !== prevRaw;
        var looksLikeRegenerate = rawChanged && (
            currentRaw.length < prevRaw.length ||
            session.finished ||
            wasComplete
        );

        session.fullTextRaw = currentRaw;
        session.displayText = cleanupDisplayText(session.fullTextRaw);
        session.paragraphs = splitNaturalParagraphs(session.displayText);

        if (looksLikeRegenerate) {
            session.revealedParagraphs = 0;
            session.finished = false;
            session.wrongCount = 0;
            session.currentChallenge = null;
            session.renderKey = '';
            session.streamKey = '';
            session.solvedWords = [];
        }

        if (session.revealedParagraphs > session.paragraphs.length) {
            session.revealedParagraphs = session.paragraphs.length;
        }
        if (session.revealedParagraphs < 0) {
            session.revealedParagraphs = 0;
        }
    }

    refreshChallenge(session, null);
    return session;
}

function getDomRefs(messageId) {
    var $mes = $('.mes[mesid="' + String(messageId) + '"]');
    if ($mes.length === 0) return null;
    var $text = $mes.find('.mes_text').first();
    if ($text.length === 0) return null;
    return { $mes: $mes, $text: $text };
}

function ensureCustomBody(refs) {
    var $parent = refs.$text.parent();
    var $body = $parent.children('.learnlock-custom-body');
    if ($body.length === 0) {
        $body = $('<div class="learnlock-custom-body"></div>');
        refs.$text.after($body);
    }
    return $body;
}

   function setStreamLock(messageId, locked, session, settings) {
       var refs = getDomRefs(messageId);
       if (!refs) return;

       var $body = ensureCustomBody(refs);

       if (!locked) {
           refs.$mes.removeClass('learnlock-hide-original');
           refs.$text.removeClass('learnlock-force-hide');
           $body.empty();
           return;
       }

       var parts = getVisibleParagraphs(session);
       var hidden = getHiddenParagraphCount(session);

       if (hidden <= 0) {
           refs.$mes.removeClass('learnlock-hide-original');
           refs.$text.removeClass('learnlock-force-hide');
           $body.empty();
           return;
       }

       refs.$mes.addClass('learnlock-hide-original');
       refs.$text.addClass('learnlock-force-hide');

       if ($body.find('.learnlock-word-card-wrap').length > 0) return;

       var key = [
           'stream',
           messageId,
           session.revealedParagraphs,
           session.paragraphs.length,
           session.finished ? 1 : 0,
           session.wrongCount,
           session.currentChallenge ? session.currentChallenge.question : '',
           session.currentChallenge ? session.currentChallenge.answer : ''
       ].join('|');

       if (session.streamKey === key) return;
       session.streamKey = key;

       var highlightLimit = getHighlightLimit(settings);
       var totalCandidates = 0;
       for (var tc = 0; tc < parts.length; tc += 1) {
           totalCandidates += countCandidates(String(parts[tc] || ''));
       }
       var highlightState = createHighlightState(highlightLimit, totalCandidates);

       var html = '<div class="learnlock-message-wrapper"><div class="learnlock-visible-text">';
       for (var i = 0; i < parts.length; i += 1) {
           var partText = String(parts[i] || '');
           var partHtml = highlightParagraph(
               partText,
               session.currentChallenge,
               session.solvedWords || [],
               highlightState
           );
           if (!partHtml) partHtml = escapeHtml(partText);
           html += '<div class="learnlock-visible-paragraph">' + partHtml + '</div>';
       }
       var statusText = '🔒 生成中：已解锁 ' + String(parts.length) + ' 段，剩余 ' + String(hidden) + ' 段';
       if (session.currentChallenge) {
           statusText += ' — 可在下方答题解锁';
       }
       html += '</div><div class="learnlock-hint">' + statusText + '</div></div>';

       $body.html(html);
   }

function buildRenderKey(session) {
    return [
        session.finished ? 1 : 0,
        session.revealedParagraphs,
        session.paragraphs.length,
        session.wrongCount,
        session.currentChallenge ? session.currentChallenge.question : '',
        session.currentChallenge ? session.currentChallenge.answer : '',
        (session.solvedWords || []).length
    ].join('|');
}

function findHighlightSpans(content, lookupEn, lookupZh) {
    var spans = [];

    // 英文词
    if (lookupEn) {
        var enRe = /[a-zA-Z][a-zA-Z'-]{1,30}[a-zA-Z]/g;
        var match;
        while ((match = enRe.exec(content)) !== null) {
            var w = match[0].toLowerCase().replace(/^['-]+|['-]+$/g, '');
            if (w.length < 3) continue;
            var entry = lookupEn(w);
            if (!entry) continue;
            spans.push({
                start: match.index, end: match.index + match[0].length,
                raw: match[0], word: w, lang: 'en', entry: entry
            });
        }
    }

    // 中文词（最长优先 4→2）
    if (lookupZh) {
        for (var len = 4; len >= 2; len--) {
            for (var i = 0; i <= content.length - len; i++) {
                var overlapped = false;
                for (var si = 0; si < spans.length; si++) {
                    if (i < spans[si].end && i + len > spans[si].start) {
                        overlapped = true;
                        break;
                    }
                }
                if (overlapped) continue;

                var seg = content.substring(i, i + len);
                var allCjk = true;
                for (var ci = 0; ci < seg.length; ci++) {
                    var code = seg.charCodeAt(ci);
                    if (code < 0x4e00 || code > 0x9fff) { allCjk = false; break; }
                }
                if (!allCjk) continue;

                var zhEntry = lookupZh(seg);
                if (!zhEntry) continue;
                spans.push({
                    start: i, end: i + len,
                    raw: seg, word: seg, lang: 'zh', entry: zhEntry
                });
            }
        }
    }

    spans.sort(function (a, b) { return a.start - b.start; });
    return spans;
}

   function injectHighlightsToRenderedDom($textEl, solvedWords, messageId, highlightLimit) {
       if (!$textEl || $textEl.length === 0) return;

       var diffMod = window.__learnlockDifficultyModule;
       var lookupEn = diffMod ? diffMod.lookupEnWord : null;
       var lookupZh = diffMod ? diffMod.lookupZhWord : null;
       if (!lookupEn && !lookupZh) return;

       var cleanText = '';
       try {
           var ctxRef = getContext();
           var msgRef = (ctxRef.chat || [])[messageId];
           if (msgRef && msgRef.mes) {
               cleanText = cleanupDisplayText(String(msgRef.mes));
           }
       } catch (_) {}
       var cleanTextLower = cleanText.toLowerCase();

       var solvedSet = {};
       if (Array.isArray(solvedWords)) {
           for (var i = 0; i < solvedWords.length; i++) {
               solvedSet[String(solvedWords[i]).toLowerCase()] = true;
           }
       }

       var limitValue = Number(highlightLimit);
       var limitEnabled = Number.isFinite(limitValue) && limitValue > 0;

       // ===== 第一遍：收集所有候选高亮位置 =====
       var walker = document.createTreeWalker(
           $textEl[0], NodeFilter.SHOW_TEXT, null, false
       );
       var textNodes = [];
       while (walker.nextNode()) {
           textNodes.push(walker.currentNode);
       }

       var allCandidates = []; // { nodeIndex, node, span: {start,end,raw,word,lang,entry} }

       for (var n = 0; n < textNodes.length; n++) {
           var node = textNodes[n];
           var parent = node.parentNode;
           if (!parent) continue;
           if (parent.classList && parent.classList.contains('learnlock-hl-word')) continue;

           var content = node.nodeValue || '';
           if (content.length < 2) continue;

           var spans = [];

           if (lookupEn) {
               var enRe = /[a-zA-Z][a-zA-Z'-]{1,30}[a-zA-Z]/g;
               var match;
               while ((match = enRe.exec(content)) !== null) {
                   var w = match[0].toLowerCase().replace(/^['-]+|['-]+$/g, '');
                   if (w.length < 3) continue;
                   if (cleanText && cleanTextLower.indexOf(w) < 0) continue;
                   var enEntry = lookupEn(w);
                   if (!enEntry) continue;
                   spans.push({
                       start: match.index, end: match.index + match[0].length,
                       raw: match[0], word: w, lang: 'en', entry: enEntry
                   });
               }
           }

           if (lookupZh) {
               for (var len = 4; len >= 2; len--) {
                   for (var ci = 0; ci <= content.length - len; ci++) {
                       var overlapped = false;
                       for (var si = 0; si < spans.length; si++) {
                           if (ci < spans[si].end && ci + len > spans[si].start) {
                               overlapped = true; break;
                           }
                       }
                       if (overlapped) continue;

                       var seg = content.substring(ci, ci + len);
                       var allCjk = true;
                       for (var cci = 0; cci < seg.length; cci++) {
                           var code = seg.charCodeAt(cci);
                           if (code < 0x4e00 || code > 0x9fff) { allCjk = false; break; }
                       }
                       if (!allCjk) continue;
                       if (cleanText && cleanText.indexOf(seg) < 0) continue;

                       var zhEntry = lookupZh(seg);
                       if (!zhEntry) continue;
                       spans.push({
                           start: ci, end: ci + len,
                           raw: seg, word: seg, lang: 'zh', entry: zhEntry
                       });
                   }
               }
           }

           if (spans.length === 0) continue;
           spans.sort(function (a, b) { return a.start - b.start; });

           var merged = [];
           var lastEnd = -1;
           for (var mi = 0; mi < spans.length; mi++) {
               if (spans[mi].start >= lastEnd) {
                   merged.push(spans[mi]);
                   lastEnd = spans[mi].end;
               }
           }

           for (var ms = 0; ms < merged.length; ms++) {
               allCandidates.push({
                   nodeIndex: n,
                   node: node,
                   span: merged[ms]
               });
           }
       }

       if (allCandidates.length === 0) return;

       // ===== 随机抽取 =====
       var selected;
       if (limitEnabled && allCandidates.length > limitValue) {
           // Fisher-Yates 洗牌后取前 limitValue 个
           var shuffled = allCandidates.slice();
           for (var fi = shuffled.length - 1; fi > 0; fi--) {
               var fj = Math.floor(Math.random() * (fi + 1));
               var tmp = shuffled[fi];
               shuffled[fi] = shuffled[fj];
               shuffled[fj] = tmp;
           }
           selected = shuffled.slice(0, limitValue);
       } else {
           selected = allCandidates.slice();
       }

       // ===== 按 nodeIndex + start 排序（保证 DOM 替换顺序正确） =====
       selected.sort(function (a, b) {
           if (a.nodeIndex !== b.nodeIndex) return a.nodeIndex - b.nodeIndex;
           return a.span.start - b.span.start;
       });

       // ===== 按 node 分组 =====
       var grouped = {};
       for (var gi = 0; gi < selected.length; gi++) {
           var key = selected[gi].nodeIndex;
           if (!grouped[key]) grouped[key] = [];
           grouped[key].push(selected[gi].span);
       }

       // ===== 第二遍：替换 DOM =====
       var nodeKeys = Object.keys(grouped).map(Number).sort(function (a, b) { return b - a; });
       for (var nk = 0; nk < nodeKeys.length; nk++) {
           var nodeIdx = nodeKeys[nk];
           var targetNode = textNodes[nodeIdx];
           var targetParent = targetNode.parentNode;
           if (!targetParent) continue;
           if (targetParent.classList && targetParent.classList.contains('learnlock-hl-word')) continue;

           var targetContent = targetNode.nodeValue || '';
           var nodeSpans = grouped[nodeIdx];
           nodeSpans.sort(function (a, b) { return a.start - b.start; });

           var frag = document.createDocumentFragment();
           var cursor = 0;

           for (var s = 0; s < nodeSpans.length; s++) {
               var sp = nodeSpans[s];
               if (sp.start > cursor) {
                   frag.appendChild(document.createTextNode(targetContent.substring(cursor, sp.start)));
               }

               var isSolved = !!solvedSet[String(sp.word).toLowerCase()];
               var span = document.createElement('span');
               span.className = 'learnlock-hl-word' + (isSolved ? ' learnlock-hl-solved' : '');
               span.setAttribute('data-hl-word', sp.word);
               span.setAttribute('data-hl-lang', sp.lang);
               span.setAttribute('data-hl-level', sp.entry.l || '');
               span.setAttribute('data-hl-pos', sp.entry.p || '');
               var trans = Array.isArray(sp.entry.t) ? sp.entry.t.slice(0, 3).join('，') : '';
               span.setAttribute('data-hl-trans', trans);
               span.title = (sp.entry.l || '') + ' ' + (sp.entry.p || '') + ' — ' + trans;
               span.textContent = sp.raw;
               frag.appendChild(span);

               cursor = sp.end;
           }

           if (cursor < targetContent.length) {
               frag.appendChild(document.createTextNode(targetContent.substring(cursor)));
           }

           targetParent.replaceChild(frag, targetNode);
       }
   }

   function renderLockedMessage(messageId, session, settings) {
       var refs = getDomRefs(messageId);
       if (!refs) return;

       var $body = ensureCustomBody(refs);
       var key = buildRenderKey(session);
       session.renderKey = key;

       var highlightLimit = getHighlightLimit(settings);

       if (isComplete(session)) {
           refs.$mes.removeClass('learnlock-hide-original');
           refs.$text.removeClass('learnlock-force-hide');
           $body.empty();

           setTimeout(function () {
               var freshRefs = getDomRefs(messageId);
               if (!freshRefs) return;
               if (freshRefs.$text.find('.learnlock-hl-word').length > 0) return;
               injectHighlightsToRenderedDom(
                   freshRefs.$text,
                   session.solvedWords || [],
                   messageId,
                   highlightLimit
               );
           }, 120);
           return;
       }

       refs.$mes.addClass('learnlock-hide-original');
       refs.$text.addClass('learnlock-force-hide');
       $body.empty();

       var $wrapper = $('<div class="learnlock-message-wrapper"></div>');
       var $visible = $('<div class="learnlock-visible-text"></div>');
       $wrapper.append($visible);

       var parts = getVisibleParagraphs(session);
       var totalCandidates = 0;
       for (var tc = 0; tc < parts.length; tc += 1) {
           totalCandidates += countCandidates(String(parts[tc] || ''));
       }
       var highlightState = createHighlightState(highlightLimit, totalCandidates);
       for (var i = 0; i < parts.length; i += 1) {
           var paragraphHtml = highlightParagraph(
               String(parts[i] || ''),
               session.currentChallenge,
               session.solvedWords || [],
               highlightState
           );
           var $p = $('<div class="learnlock-visible-paragraph"></div>');
           $p.html(paragraphHtml || escapeHtml(String(parts[i] || '')));
           $visible.append($p);
       }

       var hidden = getHiddenParagraphCount(session);
       var unlocked = parts.length;
       var $hint = $('<div class="learnlock-hint"></div>');
       $hint.text('🔒 正文已锁定：已解锁 ' + String(unlocked) + ' 段，剩余 ' + String(hidden) + ' 段');

       $wrapper.append($hint);
       $body.append($wrapper);
   }

function applySm2FailWrapper(item) {
    sm2Fail(item);
}

function addWrongBookItem(moduleName, payload, settings) {
    var context = getContext();
    var extensionSettings = context.extensionSettings;

    if (!extensionSettings[moduleName]) return;
    if (!Array.isArray(extensionSettings[moduleName].wrongBook)) {
        extensionSettings[moduleName].wrongBook = [];
    }

    var list = extensionSettings[moduleName].wrongBook;
    var maxItems = Number(settings.wrongBookMaxItems || 200);
    var q = String(payload.question || '');
    var a = String(payload.answer || '');
    var key = normalizeAnswer(q) + '__' + normalizeAnswer(a);

    var found = null;
    for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].key === key) {
            found = list[i];
            break;
        }
    }

    if (found) {
        found.wrongCount = Number(found.wrongCount || 0) + 1;
        found.masteryScore = 0;
        found.lastWrongUserAnswer = String(payload.userAnswer || '');
        found.lastWrongAt = Date.now();
        applySm2FailWrapper(found);
    } else {
        var item = {
            key: key,
            type: String(payload.type || ''),
            question: q,
            answer: a,
            wrongCount: 1,
            masteryScore: 0,
            firstWrongUserAnswer: String(payload.userAnswer || ''),
            lastWrongUserAnswer: String(payload.userAnswer || ''),
            firstWrongAt: Date.now(),
            lastWrongAt: Date.now(),
            sm2Ease: 2.5,
            sm2Repetitions: 0,
            sm2IntervalDays: 0,
            dueAt: Date.now(),
            lastReviewAt: 0
        };
        applySm2FailWrapper(item);
        list.push(item);
    }

    if (list.length > maxItems) {
        extensionSettings[moduleName].wrongBook = list.slice(list.length - maxItems);
    }

    context.saveSettingsDebounced();
    document.dispatchEvent(new CustomEvent('learnlock:wrongbook-updated'));
}

function findDockAnchor() {
    var $sendForm = $('#send_form').first();
    if ($sendForm.length > 0) return $sendForm;
    return $();
}

function ensureDock() {
    var $dock = $('#learnlock-floating-dock');
    if ($dock.length === 0) {
        $dock = $('<div id="learnlock-floating-dock"></div>');
    }

    var $anchor = findDockAnchor();

    if ($anchor.length > 0) {
        if ($dock.next().get(0) !== $anchor.get(0)) {
            $anchor.before($dock);
        }
        $dock.removeClass('learnlock-dock-fixed').addClass('learnlock-dock-inline');
    } else {
        if (!$dock.parent().is('body')) {
            $('body').append($dock);
        }
        $dock.removeClass('learnlock-dock-inline').addClass('learnlock-dock-fixed');
    }

    return $dock;
}

function removeDock() {
    $('#learnlock-floating-dock').remove();
    dockRenderKey = '';
}

function renderDock(settings, forceUpdate) {
    if (!settings || !settings.enabled) {
        removeDock();
        return;
    }

    var messageId = pickActiveMessageId();
    if (messageId < 0) {
        removeDock();
        return;
    }

    var session = sessions.get(messageId);
    if (!session) {
        removeDock();
        return;
    }

    if (isComplete(session)) {
        removeDock();
        return;
    }

    var hidden = getHiddenParagraphCount(session);
    var $dock = ensureDock();

    var oldInput = document.getElementById('learnlock-floating-input');
    var oldInputValue = oldInput ? String(oldInput.value || '') : '';
    var oldFocused = !!(oldInput && document.activeElement === oldInput);
    var oldSelectionStart = oldInput && Number.isFinite(oldInput.selectionStart) ? oldInput.selectionStart : -1;
    var oldSelectionEnd = oldInput && Number.isFinite(oldInput.selectionEnd) ? oldInput.selectionEnd : -1;

    if (hidden <= 0 && !session.finished) {
        if (!streamState.active) {
            // 流式已结束但 finished 未设置，补设并移除 dock
            session.finished = true;
            renderLockedMessage(messageId, session);
            removeDock();
            return;
        }
        if (!session.currentChallenge) {
            var waitKey = 'wait|' + String(messageId);
            if (dockRenderKey !== waitKey) {
                dockRenderKey = waitKey;
                $dock.html(
                    '<div class="learnlock-floating-card">' +
                    '  <div class="learnlock-floating-title">⌛ 正在生成中，内容解锁后即可阅读...</div>' +
                    '</div>'
                );
            }
            return;
        }
    }

    if (!session.currentChallenge) {
        removeDock();
        return;
    }

    var unlockCount = getUnlockParagraphCount(settings);
    var q = session.currentChallenge;
    var hint = '';
    if (session.wrongCount >= Number(settings.maxWrongAttemptsBeforeHint || 2)) {
        var first = String(q.answer || '').trim().charAt(0);
        hint = '提示：答案首字母是 ' + (first || '-');
    }

    var key = [
        'quiz',
        messageId,
        unlockCount,
        q.question,
        q.answer,
        session.wrongCount
    ].join('|');

    var challengeAudioWord = getChallengeAudioWord(q);

    if (dockRenderKey === key) return;

    var currentMid = Number($('#learnlock-floating-submit').attr('data-mid'));
    if (!forceUpdate && isFloatingInputFocused() && currentMid === messageId) {
        return;
    }

    dockRenderKey = key;

    var html = ''
        + '<div class="learnlock-floating-card">'
        + '  <div class="learnlock-floating-title">🔒 学习解锁题（消息 #' + String(messageId) + '，每题解锁 ' + String(unlockCount) + ' 段）<span class="learnlock-challenge-source">[' + escapeHtml(String(q.source || 'unknown')) + ']</span></div>'
        + '  <div class="learnlock-question">'
        + (challengeAudioWord
            ? ('      <button type="button" class="learnlock-challenge-audio-btn" data-audio-url="" data-tts-word="' + escapeHtml(challengeAudioWord) + '" data-tts-lang="en" title="播放题目发音">' + ICON_AUDIO + '</button>')
            : '')
        + '      <span class="learnlock-question-text">' + escapeHtml(String(q.question || '')) + '</span>'
        + '  </div>'
        + '  <form id="learnlock-floating-form" class="learnlock-answer-row" data-mid="' + String(messageId) + '" action="javascript:void(0)" autocomplete="off">'
        + '      <input id="learnlock-floating-input" class="text_pole learnlock-answer-input" type="text" enterkeyhint="send" placeholder="输入答案后回车或点右侧按钮提交">'
        + '      <button id="learnlock-floating-submit" type="submit" class="menu_button" aria-label="提交答案" title="提交答案">'
        + '          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"></path></svg>'
        + '      </button>'
        + '  </form>'
        + '  <div class="learnlock-hint">' + escapeHtml(String(hint || '')) + '</div>'
        + '</div>';

    $dock.html(html);

    var newInput = document.getElementById('learnlock-floating-input');
    if (newInput && oldInputValue) {
        newInput.value = oldInputValue;
    }

    if (newInput && oldFocused) {
        newInput.focus();
        if (oldSelectionStart >= 0 && oldSelectionEnd >= 0) {
            try {
                newInput.setSelectionRange(oldSelectionStart, oldSelectionEnd);
            } catch (_e) {
            }
        }
    }
}

function renderSession(messageId, settings) {
    var context = getContext();
    var msg = (context.chat || [])[messageId];
    var session = sessions.get(messageId);
    if (!msg || !session) return;
    if (!settings || !settings.enabled) return;

       var hidden = getHiddenParagraphCount(session);
       if (streamState.active && messageId === findLatestBotMessageId() && hidden > 0) {
           setStreamLock(messageId, true, session, settings);
       } else {
           setStreamLock(messageId, false, session, settings);
           renderLockedMessage(messageId, session, settings);
       }
}

function clearAllLocksFromDomOnly() {
    sessions.forEach(function (_session, messageId) {
        var refs = getDomRefs(messageId);
        if (!refs) return;
        refs.$mes.removeClass('learnlock-hide-original');
        refs.$text.removeClass('learnlock-force-hide');
        refs.$text.parent().children('.learnlock-custom-body').remove();
    });
}

function cleanupAllSessionsAndUi() {
    clearAllLocksFromDomOnly();
    sessions.clear();
    managedMessageIds.clear();
    removeDock();
    activeMessageId = -1;
}

function shouldThrottleStreamTick() {
    var now = Date.now();
    if (now - streamState.lastTickAt < 70) return true;
    streamState.lastTickAt = now;
    return false;
}

function isFloatingInputFocused() {
    var ae = document.activeElement;
    return !!(ae && ae.id === 'learnlock-floating-input');
}

function submitAnswer(moduleName, getSettings, messageId, userAnswer) {
    var settings = getSettings();
    var session = sessions.get(messageId);
    if (!session || !session.currentChallenge) {
        pushDebugLog('submit-skip', {
            reason: 'no-session-or-challenge',
            messageId: Number(messageId)
        });
        return;
    }

    var unlockCount = getUnlockParagraphCount(settings);
    var current = session.currentChallenge;

    var normalizedUser = normalizeAnswer(userAnswer);
    if (!normalizedUser) {
        pushDebugLog('submit-empty', {
            messageId: Number(messageId)
        });
        toastr.info('请输入答案后再提交');
        return;
    }

    var target = String(current.answer || '');
    var synonymMode = String(settings.synonymMode || 'loose');
    var extraAcceptable = Array.isArray(current.acceptableAnswers) ? current.acceptableAnswers : [];
    var judgeResult = judgeAnswer(userAnswer, target, current.type, synonymMode, extraAcceptable);

    if (judgeResult.correct) {
        // 记录已掌握的词
        if (current.vocabEntry && current.vocabEntry.w) {
            if (!Array.isArray(session.solvedWords)) session.solvedWords = [];
            var solvedWord = String(current.vocabEntry.w).toLowerCase();
            if (session.solvedWords.indexOf(solvedWord) < 0) {
                session.solvedWords.push(solvedWord);
            }
        }
        // 记录已出过的词（防重复）
        var askedKey = String(current.answer || '').toLowerCase();
        if (!Array.isArray(session.askedWords)) session.askedWords = [];
        if (session.askedWords.indexOf(askedKey) < 0) {
            session.askedWords.push(askedKey);
        }

        // SM-2：错题本中答对时更新间隔
        if (current.source === 'wrongbook') {
            var context0 = getContext();
            var wbList = (context0.extensionSettings[moduleName] || {}).wrongBook || [];
            var wbQuestion = String(current.question || '');
            var wbAnswer = String(current.answer || '');
            var wbKey = normalizeAnswer(wbQuestion) + '__' + normalizeAnswer(wbAnswer);
            for (var wi = 0; wi < wbList.length; wi++) {
                if (wbList[wi] && wbList[wi].key === wbKey) {
                    sm2Success(wbList[wi], 'good');
                    break;
                }
            }
            context0.saveSettingsDebounced();
        }

        session.questionsAnswered = (session.questionsAnswered || 0) + 1;

        pushDebugLog('submit-correct', {
            messageId: Number(messageId),
            beforeRevealed: Number(session.revealedParagraphs || 0),
            paragraphTotal: Number(session.paragraphs.length || 0),
            questionsAnswered: Number(session.questionsAnswered),
            feedback: String(judgeResult.feedback || '')
        });
        session.wrongCount = 0;
        session.currentChallenge = null;
        session.revealedParagraphs = Math.min(session.paragraphs.length, session.revealedParagraphs + unlockCount);

        refreshChallenge(session, settings);
        if (isComplete(session)) toastr.success(judgeResult.feedback + ' 已全部解锁！');
        else toastr.success(judgeResult.feedback + ' 已解锁下一批自然段');
    } else {
        pushDebugLog('submit-wrong', {
            messageId: Number(messageId),
            wrongCountBefore: Number(session.wrongCount || 0),
            feedback: String(judgeResult.feedback || '')
        });
        session.wrongCount += 1;
        addWrongBookItem(moduleName, {
            type: current.type,
            question: current.question,
            answer: current.answer,
            userAnswer: userAnswer
        }, settings);
        toastr.warning(judgeResult.feedback);
    }

    renderSession(messageId, settings);
    $('#learnlock-floating-input').val('');
    renderDock(settings, true);
}

function uninstallHardEnterGuard() {
    if (!window.__learnlockHardEnterGuard) return;
    var guard = window.__learnlockHardEnterGuard;

    if (guard.keydown) window.removeEventListener('keydown', guard.keydown, true);
    if (guard.keypress) window.removeEventListener('keypress', guard.keypress, true);
    if (guard.keyup) window.removeEventListener('keyup', guard.keyup, true);

    window.__learnlockHardEnterGuard = null;
}

function installHardEnterGuard(moduleName, getSettings, ensureEnabledOrPauseUiOnly) {
    uninstallHardEnterGuard();

    function isEnterEvent(e) {
        return e && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter');
    }

    function isFloatingInputTarget(e) {
        var t = e && e.target;
        return !!(t && t.id === 'learnlock-floating-input');
    }

    function stopEvent(e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }

    var onKeydownCapture = function (e) {
        if (!isEnterEvent(e)) return;
        pushDebugLog('guard-keydown-capture-seen', {
            target: describeElement(e.target),
            active: describeElement(document.activeElement),
            floatingTarget: isFloatingInputTarget(e),
            composing: !!e.isComposing
        });

        if (!isFloatingInputTarget(e)) return;
        if (e.isComposing) return;

        stopEvent(e);

        if (!ensureEnabledOrPauseUiOnly()) return false;

        var messageId = pickActiveMessageId();
        if (messageId < 0) {
            pushDebugLog('guard-submit-skip', { reason: 'no-active-message' });
            return false;
        }

        var input = document.getElementById('learnlock-floating-input');
        var userAnswer = input ? String(input.value || '') : '';
        pushDebugLog('guard-submit-start', {
            messageId: messageId,
            answerLength: userAnswer.length
        });

        submitAnswer(moduleName, getSettings, messageId, userAnswer);

        setTimeout(function () {
            var nextInput = document.getElementById('learnlock-floating-input');
            if (nextInput) {
                nextInput.focus();
                pushDebugLog('guard-refocus-ok', {
                    active: describeElement(document.activeElement)
                });
            } else {
                pushDebugLog('guard-refocus-skip', {
                    reason: 'input-not-found'
                });
            }
        }, 0);

        return false;
    };

    var onKeypressCapture = function (e) {
        if (!isFloatingInputTarget(e)) return;
        if (!isEnterEvent(e)) return;
        pushDebugLog('guard-keypress-capture-stop', {
            target: describeElement(e.target),
            active: describeElement(document.activeElement)
        });
        stopEvent(e);
        return false;
    };

    var onKeyupCapture = function (e) {
        if (!isFloatingInputTarget(e)) return;
        if (!isEnterEvent(e)) return;
        pushDebugLog('guard-keyup-capture-stop', {
            target: describeElement(e.target),
            active: describeElement(document.activeElement)
        });
        stopEvent(e);
        return false;
    };

    window.addEventListener('keydown', onKeydownCapture, true);
    window.addEventListener('keypress', onKeypressCapture, true);
    window.addEventListener('keyup', onKeyupCapture, true);

    window.__learnlockHardEnterGuard = {
        keydown: onKeydownCapture,
        keypress: onKeypressCapture,
        keyup: onKeyupCapture
    };
}

export function startMessageLocker(args) {
    // 暴露模块引用，供词卡渲染回调使用
    import('./difficulty.js').then(function (mod) {
        window.__learnlockDifficultyModule = mod;
    }).catch(function () {});
    import('./favorites.js').then(function (mod) {
        window.__learnlockFavoritesModule = mod;
        pushDebugLog('module-loaded', { module: 'favorites' });
    }).catch(function (err) {
        console.error('[LearnLock] favorites.js 加载失败:', err);
    });

    var moduleName = (args && args.moduleName) ? args.moduleName : 'extension_learnlock_mvp';
    var getSettings = (args && args.getSettings) ? args.getSettings : function () { return {}; };

    ensureVocabLoaded().catch(function (e) {
        console.warn('[LearnLock] 词库预加载失败:', e);
    });

    var context = getContext();
    var eventSource = context.eventSource;
    var eventTypes = context.eventTypes || context.event_types;

    function ensureEnabledOrPauseUiOnly() {
        var settings = getSettings();
        if (!settings || !settings.enabled) {
            removeDock();
            return false;
        }
        return true;
    }

    installDebugApi(moduleName, getSettings, function () {
        return {
            activeElement: describeElement(document.activeElement),
            streamState: {
                active: !!streamState.active,
                lastTickAt: Number(streamState.lastTickAt || 0)
            },
            activeMessageId: Number(activeMessageId),
            dockExists: document.getElementById('learnlock-floating-dock') ? true : false,
            floatingInputExists: document.getElementById('learnlock-floating-input') ? true : false,
            floatingInputFocused: isFloatingInputFocused(),
            sessionCount: sessions.size
        };
    });

    eventSource.on(eventTypes.GENERATION_STARTED, function () {
        if (!ensureEnabledOrPauseUiOnly()) return;
        streamState.active = true;
        generationChatId = chatContextId;
    });

    eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, function () {
        if (!ensureEnabledOrPauseUiOnly()) return;
        if (!streamState.active) return;
        if (generationChatId !== chatContextId) return;
        if (shouldThrottleStreamTick()) return;

        var settings = getSettings();
        var messageId = findLatestBotMessageId();
        if (messageId < 0) return;

        var msg = (context.chat || [])[messageId];
        if (!shouldLockMessage(msg, settings)) return;

        markManagedMessageId(messageId);

        var session = ensureSession(messageId, settings);
        if (!session) return;

        // 流式期间确保有题目可答（即使 hidden 暂时为 0 也预先准备）
        if (!session.currentChallenge && !session.challengeLoading) {
            if (getHiddenParagraphCount(session) > 0) {
                refreshChallenge(session, settings);
            } else if (session.paragraphs.length > 0) {
                // 段落存在但全部已解锁，预备一道题等新段落出现
                session.currentChallenge = buildFallbackChallenge();
            }
        }

        activeMessageId = messageId;
        setStreamLock(messageId, true, session, settings);
        renderDock(settings);
    });

    eventSource.on(eventTypes.GENERATION_ENDED, function () {
        streamState.active = false;
        if (!ensureEnabledOrPauseUiOnly()) return;
        var endedChatId = generationChatId;

        setTimeout(function () {
            if (!ensureEnabledOrPauseUiOnly()) return;
            if (endedChatId !== chatContextId) return;
            var settings = getSettings();

            var messageId = findLatestBotMessageId();
            if (messageId < 0) return;

            var msg = (context.chat || [])[messageId];
            if (!shouldLockMessage(msg, settings)) return;

            markManagedMessageId(messageId);

            var session = ensureSession(messageId, settings);
            if (!session) return;

            session.finished = true;
            refreshChallenge(session, settings);
            activeMessageId = messageId;

            renderSession(messageId, settings);
            renderDock(settings);
        }, 40);
    });

    eventSource.on(eventTypes.MESSAGE_RECEIVED, function (data) {
        if (!ensureEnabledOrPauseUiOnly()) return;
        var settings = getSettings();

        var messageId = resolveMessageId(data);
        var msg = (context.chat || [])[messageId];
        if (!shouldLockMessage(msg, settings)) return;

        markManagedMessageId(messageId);

        var session = ensureSession(messageId);
        if (!session) return;

        if (!streamState.active) {
            session.finished = true;
            refreshChallenge(session, settings);
        }

        activeMessageId = messageId;
        renderSession(messageId, settings);
        renderDock(settings);
    });

    eventSource.on(eventTypes.MESSAGE_EDITED, function (data) {
        if (!ensureEnabledOrPauseUiOnly()) return;
        var settings = getSettings();

        var messageId = resolveMessageId(data);
        if (!sessions.has(messageId)) return;

        var session = ensureSession(messageId);
        if (!session) return;

        renderSession(messageId, settings);
        renderDock(settings);
    });

    // 处理消息滑动（swipe）
    var swipeEventName = eventTypes.MESSAGE_SWIPED || eventTypes.SWIPE_SELECTED || null;
    if (swipeEventName) {
        eventSource.on(swipeEventName, function (data) {
            if (!ensureEnabledOrPauseUiOnly()) return;
            var settings = getSettings();

            var messageId = resolveMessageId(data);
            if (messageId < 0) messageId = findLatestBotMessageId();
            if (messageId < 0) return;

            // swipe 后内容已变，重置 session
            if (sessions.has(messageId)) {
                sessions.delete(messageId);
            }

            var msg = (context.chat || [])[messageId];
            if (!shouldLockMessage(msg, settings)) {
                // 新 swipe 版本不需要锁定，恢复原样
                var refs = getDomRefs(messageId);
                if (refs) {
                    refs.$mes.removeClass('learnlock-hide-original');
                    refs.$text.removeClass('learnlock-force-hide');
                    refs.$text.parent().children('.learnlock-custom-body').remove();
                }
                removeDock();
                return;
            }

            markManagedMessageId(messageId);
            var session = ensureSession(messageId, settings);
            if (!session) return;

            session.finished = true;
            refreshChallenge(session, settings);
            activeMessageId = messageId;

            renderSession(messageId, settings);
            renderDock(settings, true);
        });
    }

    // 兜底：如果没有专门的 swipe 事件，用 CHARACTER_MESSAGE_RENDERED 处理
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, function (data) {
        if (!ensureEnabledOrPauseUiOnly()) return;
        var settings = getSettings();

        var messageId = resolveMessageId(data);

        // 检测是否是 swipe 导致的重新渲染（内容变了）
        if (sessions.has(messageId)) {
            var oldSession = sessions.get(messageId);
            var currentMsg = (context.chat || [])[messageId];
            if (currentMsg && String(currentMsg.mes || '') !== String(oldSession.fullTextRaw || '')) {
                // 内容变了，重建 session
                sessions.delete(messageId);
                markManagedMessageId(messageId);
                var newSession = ensureSession(messageId, settings);
                if (newSession) {
                    newSession.finished = true;
                    refreshChallenge(newSession, settings);
                    activeMessageId = messageId;
                    renderSession(messageId, settings);
                    renderDock(settings, true);
                }
                return;
            }
        }

        if (!sessions.has(messageId)) {
            // 无 session 的 bot 消息也注入词汇高亮（使刷新后仍可点击查词卡）
            var hlMsg = (context.chat || [])[messageId];
            if (hlMsg && !hlMsg.is_user && settings.enabled) {
                setTimeout(function () {
                    var hlRefs = getDomRefs(messageId);
                    if (!hlRefs) return;
                    if (hlRefs.$text.find('.learnlock-hl-word').length > 0) return;
                    injectHighlightsToRenderedDom(hlRefs.$text, [], messageId, getHighlightLimit(settings));
                }, 250);
            }
            return;
        }
        var session = ensureSession(messageId);
        if (!session) return;

        if (activeMessageId < 0) activeMessageId = messageId;
        renderSession(messageId, settings);
        renderDock(settings);

        // 已完成的 session 重新注入高亮（ST 可能重建了 DOM）
        if (isComplete(session)) {
            setTimeout(function () {
                var rRefs = getDomRefs(messageId);
                if (!rRefs) return;
                if (rRefs.$text.find('.learnlock-hl-word').length > 0) return;
                injectHighlightsToRenderedDom(rRefs.$text, session.solvedWords || [], messageId, getHighlightLimit(settings));
            }, 150);
        }
    });
    
    eventSource.on(eventTypes.CHAT_CHANGED, function () {
        chatContextId++;
        streamState.active = false;
        cleanupAllSessionsAndUi();
        pushDebugLog('chat-changed', { newChatContextId: chatContextId });
    });

    document.removeEventListener('learnlock:enabled-changed', window.__learnlockEnabledChangedListener);
    window.__learnlockEnabledChangedListener = function (ev) {
        var enabled = Boolean(ev && ev.detail && ev.detail.enabled);
        if (!enabled) {
            removeDock();
        } else {
            var settings = getSettings();
            sessions.forEach(function (_session, messageId) {
                renderSession(messageId, settings);
            });
            renderDock(settings, true);
        }
    };
    document.addEventListener('learnlock:enabled-changed', window.__learnlockEnabledChangedListener);

    $(document).off('click.learnlock_pick_session', '.mes');
    $(document).on('click.learnlock_pick_session', '.mes', function () {
        if (!ensureEnabledOrPauseUiOnly()) return;
        var settings = getSettings();

        var mid = Number($(this).attr('mesid'));
        if (!Number.isFinite(mid)) return;
        var session = sessions.get(mid);
        if (!session) return;
        if (isComplete(session)) return;

        activeMessageId = mid;
        renderDock(settings);
    });

    $(document).off('submit.learnlock_submit_floating', '#learnlock-floating-form');
    $(document).on('submit.learnlock_submit_floating', '#learnlock-floating-form', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        if (!ensureEnabledOrPauseUiOnly()) return false;

        var messageId = Number($(this).attr('data-mid'));
        if (!Number.isFinite(messageId)) {
            messageId = pickActiveMessageId();
        }
        if (messageId < 0) return false;

        var userAnswer = String($('#learnlock-floating-input').val() || '');
        submitAnswer(moduleName, getSettings, messageId, userAnswer);

        setTimeout(function () {
            var nextInput = document.getElementById('learnlock-floating-input');
            if (nextInput) nextInput.focus();
        }, 0);

        return false;
    });

    // ===== 收藏按钮点击 =====
    $(document).off('click.learnlock_fav_btn', '.learnlock-wc-fav-btn');
    $(document).on('click.learnlock_fav_btn', '.learnlock-wc-fav-btn', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        var $btn = $(this);
        var word = $btn.attr('data-fav-word') || '';
        var lang = $btn.attr('data-fav-lang') || 'en';

        pushDebugLog('fav-btn-click', { word: word, lang: lang });

        var diffMod = window.__learnlockDifficultyModule;
        var entry = null;
        if (diffMod) {
            entry = (lang === 'en') ? diffMod.lookupEnWord(word) : diffMod.lookupZhWord(word);
        }
        if (!entry) {
            entry = { w: word, l: '', p: '', r: 0, t: [], a: [] };
        }

        try {
            if (isFavorite(word, lang)) {
                var fKey = word.toLowerCase() + ':' + lang;
                removeFavorite(fKey);
                toastr.info('已取消收藏：' + word);
            } else {
                var extra = {};
                var $card = $btn.closest('.learnlock-word-card');
                var phonEl = $card.find('.learnlock-wc-phonetic');
                if (phonEl.length) extra.phonetic = phonEl.text().trim();
                var audioEl = $card.find('.learnlock-wc-audio-btn');
                if (audioEl.length) extra.audioUrl = audioEl.attr('data-audio-url') || '';
                var defEl = $card.find('.learnlock-wc-row');
                defEl.each(function () {
                    var t = $(this).text();
                    if (t.indexOf('英文释义') >= 0) extra.definition = t.replace(/^.*英文释义[：:]?\s*/, '');
                    if (t.indexOf('例句') >= 0) extra.example = t.replace(/^.*例句[：:]?\s*/, '');
                });
                addFavorite(entry, lang, extra);
                toastr.success('已收藏：' + word);
            }
        } catch (err) {
            pushDebugLog('fav-btn-error', { error: String(err) });
            console.error('[LearnLock] 收藏操作失败:', err);
        }

        var nowFav = isFavorite(word, lang);
        $btn.html(nowFav ? ICON_FAV_FILLED : ICON_FAV_EMPTY)
            .toggleClass('learnlock-wc-fav-active', nowFav)
            .attr('title', nowFav ? '取消收藏' : '收藏');
    });

    // ===== v0.3-B 词汇高亮点击事件 =====
    $(document).off('click.learnlock_hl_word', '.learnlock-hl-word');
    $(document).on('click.learnlock_hl_word', '.learnlock-hl-word', function (e) {
        e.stopPropagation();
        var $el = $(this);
        var word = $el.attr('data-hl-word') || '';
        var lang = $el.attr('data-hl-lang') || 'en';

        var $existing = $el.next('.learnlock-word-card-wrap');
        if ($existing.length > 0) {
            $existing.remove();
            return;
        }

        $('.learnlock-word-card-wrap').remove();

        var entry = null;
        var diffMod = window.__learnlockDifficultyModule;
        if (diffMod) {
            entry = (lang === 'en') ? diffMod.lookupEnWord(word) : diffMod.lookupZhWord(word);
        }

        if (!entry) {
            entry = {
                w: word,
                l: $el.attr('data-hl-level') || '',
                p: $el.attr('data-hl-pos') || '',
                t: ($el.attr('data-hl-trans') || '').split('，').filter(function (x) { return x; }),
                a: [],
                r: 0
            };
        }

        var cardHtml = buildWordCardHtml(entry, lang, null);

        var $card = $('<div class="learnlock-word-card-wrap"></div>');
        $card.html(cardHtml);
        $el.after($card);

        dictLookup(word, lang).then(function (info) {
            if (!info || !info.found) return;
            $card.html(buildWordCardHtml(entry, lang, info));
        }).catch(function (err) {
            pushDebugLog('dict-lookup-fail', { word: word, lang: lang, error: String(err) });
        });
    });

    $(document).off('click.learnlock_close_card');
    $(document).on('click.learnlock_close_card', function (e) {
        if ($(e.target).closest('.learnlock-word-card-wrap').length > 0) return;
        if ($(e.target).closest('.learnlock-hl-word').length > 0) return;
        // 面板内错题/收藏区域的点击不关闭词卡
        if ($(e.target).closest('.ll-wb-item-content').length > 0) return;
        if ($(e.target).closest('.ll-fav-item').length > 0) return;
        if ($(e.target).closest('#learnlock-panel').length > 0 && $(e.target).closest('.learnlock-panel-card').length > 0) return;
        $('.learnlock-word-card-wrap').remove();
    });

    // ===== 词卡音频按钮点击 =====
    $(document).off('click.learnlock_wc_audio', '.learnlock-wc-audio-btn');
    $(document).on('click.learnlock_wc_audio', '.learnlock-wc-audio-btn', async function (e) {
        e.stopPropagation();
        e.preventDefault();

        var $btn = $(this);
        var apiUrl = $btn.attr('data-audio-url') || '';
        var ttsWord = $btn.attr('data-tts-word') || '';
        var ttsLang = $btn.attr('data-tts-lang') || 'en';

        if (!ttsWord) return;

        if (!apiUrl) {
            try {
                var info = await dictLookup(ttsWord, 'en');
                if (info && info.audioUrl) {
                    apiUrl = String(info.audioUrl);
                    $btn.attr('data-audio-url', apiUrl);
                }
            } catch (_) {}
        }

        playAudioChain(apiUrl, ttsWord, ttsLang);
    });

    $(document).off('click.learnlock_challenge_audio', '.learnlock-challenge-audio-btn');
    $(document).on('click.learnlock_challenge_audio', '.learnlock-challenge-audio-btn', async function (e) {
        e.stopPropagation();
        e.preventDefault();

        var $btn = $(this);
        var apiUrl = $btn.attr('data-audio-url') || '';
        var ttsWord = $btn.attr('data-tts-word') || '';
        var ttsLang = $btn.attr('data-tts-lang') || 'en';

        if (!ttsWord) return;

        if (!apiUrl) {
            try {
                var info = await dictLookup(ttsWord, 'en');
                if (info && info.audioUrl) {
                    apiUrl = String(info.audioUrl);
                    $btn.attr('data-audio-url', apiUrl);
                }
            } catch (_) {}
        }

        playAudioChain(apiUrl, ttsWord, ttsLang);
    });

    installHardEnterGuard(moduleName, getSettings, ensureEnabledOrPauseUiOnly);

    console.log('[LearnLockMVP] message-locker loaded (lock persists after disable, no message metadata writes)');
}