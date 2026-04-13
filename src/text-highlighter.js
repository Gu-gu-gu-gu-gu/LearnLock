/**
 * 文本高亮器：在段落中标记词库词汇（支持随机分散）
 */

import { lookupEnWord, lookupZhWord } from './difficulty.js';
import { ICON_AUDIO, ICON_FAV_EMPTY, ICON_FAV_FILLED } from './icons.js';

function escapeHtml(input) {
    var s = String(input);
    s = s.replace(/&/g, '&amp;');
    s = s.replace(/</g, '&lt;');
    s = s.replace(/>/g, '&gt;');
    s = s.replace(/"/g, '&quot;');
    s = s.split("'").join('&#39;');
    return s;
}

var SAFE_TAG_RE = /(<\/?\s*(?:details|summary|blockquote|br|hr|table|thead|tbody|tr|th|td|ul|ol|li|sup|sub|ruby|rt|rp|mark)\b[^>]*>)/gi;
var SAFE_PH_PREFIX = '\x00SAFE_TAG_';

function basicMarkdown(text) {
    var safeSlots = [];
    var raw = String(text || '');
    var protected_ = raw.replace(SAFE_TAG_RE, function (match) {
        var idx = safeSlots.length;
        safeSlots.push(match);
        return SAFE_PH_PREFIX + idx + '\x00';
    });

    var s = escapeHtml(protected_);

    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/__(.+?)__/g, '<b>$1</b>');
    s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
    s = s.replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g, '<i>$1</i>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/\n/g, '<br>');

    for (var i = 0; i < safeSlots.length; i++) {
        var ph = escapeHtml(SAFE_PH_PREFIX + i + '\x00');
        s = s.split(ph).join(safeSlots[i]);
    }

    return s;
}

function isChineseChar(c) {
    var code = c.charCodeAt(0);
    return code >= 0x4e00 && code <= 0x9fff;
}

function findEnglishWordPositions(text) {
    var results = [];
    var regex = /[a-zA-Z][a-zA-Z'-]{1,30}[a-zA-Z]/g;
    var match;
    while ((match = regex.exec(text)) !== null) {
        var word = match[0].toLowerCase().replace(/^['-]+|['-]+$/g, '');
        if (word.length < 3) continue;
        var entry = lookupEnWord(word);
        if (!entry) continue;
        results.push({
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0],
            word: word,
            lang: 'en',
            entry: entry
        });
    }
    return results;
}

function findChineseWordPositions(text) {
    var results = [];
    for (var len = 4; len >= 2; len--) {
        for (var i = 0; i <= text.length - len; i++) {
            var overlapped = false;
            for (var r = 0; r < results.length; r++) {
                if (i >= results[r].start && i < results[r].end) {
                    overlapped = true;
                    break;
                }
            }
            if (overlapped) continue;

            var segment = text.substring(i, i + len);
            var allChinese = true;
            for (var c = 0; c < segment.length; c++) {
                if (!isChineseChar(segment[c])) {
                    allChinese = false;
                    break;
                }
            }
            if (!allChinese) continue;

            var entry = lookupZhWord(segment);
            if (!entry) continue;

            results.push({
                start: i,
                end: i + len,
                raw: segment,
                word: segment,
                lang: 'zh',
                entry: entry
            });
        }
    }
    results.sort(function (a, b) { return a.start - b.start; });
    return results;
}

function mergePositions(enPos, zhPos) {
    var all = enPos.concat(zhPos);
    all.sort(function (a, b) { return a.start - b.start; });

    var merged = [];
    var lastEnd = -1;
    for (var i = 0; i < all.length; i++) {
        if (all[i].start >= lastEnd) {
            merged.push(all[i]);
            lastEnd = all[i].end;
        }
    }
    return merged;
}

/**
 * Fisher-Yates 洗牌
 */
function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

/**
 * 从所有候选位置中随机抽取指定数量，然后按位置排序
 */
function randomSelectPositions(positions, limit) {
    if (!limit || limit <= 0 || positions.length <= limit) {
        return positions;
    }
    var shuffled = shuffleArray(positions);
    var selected = shuffled.slice(0, limit);
    selected.sort(function (a, b) { return a.start - b.start; });
    return selected;
}

export function countCandidates(text) {
    if (!text) return 0;
    var enPositions = findEnglishWordPositions(text);
    var zhPositions = findChineseWordPositions(text);
    return mergePositions(enPositions, zhPositions).length;
}

export function highlightParagraph(text, currentChallenge, solvedWords, highlightState) {
    if (!text) return '';

    var enPositions = findEnglishWordPositions(text);
    var zhPositions = findChineseWordPositions(text);
    var allPositions = mergePositions(enPositions, zhPositions);

    if (allPositions.length === 0) {
        return basicMarkdown(text);
    }

    var challengeWord = '';
    if (currentChallenge && currentChallenge.vocabEntry) {
        challengeWord = String(currentChallenge.vocabEntry.w || '').toLowerCase();
    }

    var solvedSet = {};
    if (Array.isArray(solvedWords)) {
        for (var s = 0; s < solvedWords.length; s++) {
            solvedSet[String(solvedWords[s]).toLowerCase()] = true;
        }
    }

    var positions = allPositions;

    var html = '';
    var cursor = 0;

    for (var i = 0; i < positions.length; i++) {
        var pos = positions[i];

        if (highlightState && highlightState.selectedSet) {
            var globalIdx = highlightState.globalIndex;
            highlightState.globalIndex += 1;
            if (!highlightState.selectedSet[globalIdx]) {
                continue;
            }
        }

        if (pos.start > cursor) {
            html += basicMarkdown(text.substring(cursor, pos.start));
        }

        var wordLower = String(pos.word).toLowerCase();
        var isChallengeWord = (challengeWord && wordLower === challengeWord);
        var isSolved = !!solvedSet[wordLower];

        var cls = 'learnlock-hl-word';
        if (isChallengeWord) cls += ' learnlock-hl-active';
        if (isSolved) cls += ' learnlock-hl-solved';

        var level = escapeHtml(String(pos.entry.l || ''));
        var translations = '';
        if (Array.isArray(pos.entry.t)) {
            translations = escapeHtml(pos.entry.t.slice(0, 3).join('，'));
        }
        var partOfSpeech = escapeHtml(String(pos.entry.p || ''));

        html += '<span class="' + cls + '"'
            + ' data-hl-word="' + escapeHtml(pos.word) + '"'
            + ' data-hl-lang="' + escapeHtml(pos.lang) + '"'
            + ' data-hl-level="' + level + '"'
            + ' data-hl-trans="' + translations + '"'
            + ' data-hl-pos="' + partOfSpeech + '"'
            + ' title="' + level + ' ' + partOfSpeech + ' — ' + translations + '"'
            + '>' + escapeHtml(pos.raw) + '</span>';

        cursor = pos.end;
    }

    if (cursor < text.length) {
        html += basicMarkdown(text.substring(cursor));
    }

    return html;
}

/**
 * 构建词汇详情弹出卡片的 HTML
 */
export function buildWordCardHtml(entry, lang, onlineInfo) {
    if (!entry) return '';

    var translations = Array.isArray(entry.t) ? entry.t : [];
    var level = escapeHtml(String(entry.l || ''));
    var pos = escapeHtml(String(entry.p || ''));
    var rank = Number(entry.r || 0);

    var enWord = '';
    var zhWord = '';
    if (lang === 'en') {
        enWord = String(entry.w || '');
        zhWord = translations.length > 0 ? String(translations[0]) : '';
    } else {
        enWord = translations.length > 0 ? String(translations[0]) : '';
        zhWord = String(entry.w || '');
    }

    var phonetic = '';
    var definition = '';
    var example = '';
    var audioUrl = '';

    if (lang === 'en') {
        if (entry.ph) phonetic = String(entry.ph);
        if (entry.d) definition = String(entry.d);
    }

    if (lang === 'zh' && enWord) {
        var diffMod = window.__learnlockDifficultyModule;
        if (diffMod && diffMod.lookupEnWord) {
            var ecEntry = diffMod.lookupEnWord(enWord);
            if (ecEntry) {
                if (ecEntry.ph) phonetic = String(ecEntry.ph);
                if (ecEntry.d) definition = String(ecEntry.d);
            }
        }
    }

    if (onlineInfo) {
        if (onlineInfo.phonetic) phonetic = String(onlineInfo.phonetic);
        if (onlineInfo.definition) definition = String(onlineInfo.definition);
        if (onlineInfo.example) example = String(onlineInfo.example);
        if (onlineInfo.audioUrl) audioUrl = String(onlineInfo.audioUrl);
    }

    var isFav = false;
    try {
        var favMod = window.__learnlockFavoritesModule;
        if (favMod && favMod.isFavorite) {
            isFav = favMod.isFavorite(String(entry.w || ''), lang);
        }
    } catch (_) {}
    var favIcon = isFav ? ICON_FAV_FILLED : ICON_FAV_EMPTY;

    var html = '<div class="learnlock-word-card">';

    html += '<div class="learnlock-wc-header">';
    html += '<span class="learnlock-wc-word">' + escapeHtml(enWord || zhWord) + '</span>';
    if (phonetic) html += ' <span class="learnlock-wc-phonetic">' + escapeHtml(phonetic) + '</span>';
    html += ' <button class="learnlock-wc-audio-btn"'
        + ' data-audio-url="' + escapeHtml(audioUrl) + '"'
        + ' data-tts-word="' + escapeHtml(enWord || zhWord) + '"'
        + ' data-tts-lang="en"'
        + ' title="播放发音">' + ICON_AUDIO + '</button>';
    html += ' <button class="learnlock-wc-fav-btn' + (isFav ? ' learnlock-wc-fav-active' : '') + '"'
        + ' data-fav-word="' + escapeHtml(String(entry.w || '')) + '"'
        + ' data-fav-lang="' + escapeHtml(lang) + '"'
        + ' title="' + (isFav ? '取消收藏' : '收藏') + '">' + favIcon + '</button>';
    html += '</div>';

    html += '<div class="learnlock-wc-meta">';
    if (level) html += '<span class="learnlock-wc-level">' + level + '</span>';
    if (pos) html += ' <span class="learnlock-wc-pos">' + pos + '</span>';
    if (rank) html += ' <span class="learnlock-wc-rank">频率 #' + String(rank) + '</span>';
    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
        for (var ti = 0; ti < entry.tags.length; ti++) {
            html += ' <span class="learnlock-wc-tag">' + escapeHtml(entry.tags[ti]) + '</span>';
        }
    }
    html += '</div>';

    if (zhWord) {
        html += '<div class="learnlock-wc-row"><b>中文：</b>' + escapeHtml(zhWord) + '</div>';
    }

    if (definition) {
        html += '<div class="learnlock-wc-row"><b>英文释义：</b>' + escapeHtml(definition) + '</div>';
    }

    if (example) {
        html += '<div class="learnlock-wc-row"><b>例句：</b><i>' + escapeHtml(example) + '</i></div>';
    }

    html += '</div>';
    return html;
}