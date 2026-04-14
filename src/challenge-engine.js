/**
 * 出题引擎：从文本抽词、按难度筛选、混合错题、生成题目
 */

import { processText } from './word-processor.js';
import {
    ensureLoaded,
    filterByDifficulty,
    lookupEnWord,
    lookupZhWord,
    pickRandomByDifficulty,
} from './difficulty.js';

var DIFFICULTY_LEVEL_MAP = {
    beginner: ['A1'],
    elementary: ['A1', 'A2'],
    intermediate: ['A1', 'A2', 'B1'],
    upper: ['A2', 'B1', 'B2'],
    advanced: ['B1', 'B2', 'C1'],
    challenge: ['B2', 'C1'],
};

function getAllowedSetByDifficulty(difficultyLevel) {
    var key = String(difficultyLevel || 'intermediate');
    var arr = DIFFICULTY_LEVEL_MAP[key] || DIFFICULTY_LEVEL_MAP.intermediate;
    var set = {};
    for (var i = 0; i < arr.length; i++) {
        set[arr[i]] = true;
    }
    return set;
}

function isLevelAllowed(level, difficultyLevel) {
    var l = String(level || '').toUpperCase();
    if (!l) return false;
    var set = getAllowedSetByDifficulty(difficultyLevel);
    return !!set[l];
}

function isLowDifficulty(difficultyLevel) {
    var d = String(difficultyLevel || 'intermediate');
    return d === 'beginner' || d === 'elementary' || d === 'intermediate';
}

function splitAnswerCandidatesFromText(answerText) {
    var s = String(answerText || '').trim();
    if (!s) return [];
    return s
        .split(/[，,、;；|/\n]|(?:\s+or\s+)|(?:\s+OR\s+)|(?:或者)|(?:或)/)
        .map(function (x) {
            return String(x || '').trim();
        })
        .filter(function (x) {
            return x.length > 0;
        });
}

function uniqueStrings(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
        var v = String(arr[i] || '').trim();
        if (!v) continue;
        var k = v.toLowerCase();
        if (seen[k]) continue;
        seen[k] = true;
        out.push(v);
    }
    return out;
}

function chooseBestEnglishAnswer(translations, difficultyLevel) {
    var raw = Array.isArray(translations) ? translations : [];
    var list = [];
    for (var i = 0; i < raw.length; i++) {
        var part = splitAnswerCandidatesFromText(raw[i]);
        for (var j = 0; j < part.length; j++) list.push(part[j]);
    }
    list = uniqueStrings(list);

    var best = '';
    var bestScore = Number.POSITIVE_INFINITY;

    for (var t = 0; t < list.length; t++) {
        var cand = list[t];
        var entry = lookupEnWord(cand);

        if (entry && entry.l && !isLevelAllowed(entry.l, difficultyLevel)) {
            continue;
        }

        var rankScore = entry ? Number(entry.r) || 999999 : 900000;
        var lenScore = String(cand).length * 0.01;
        var score = rankScore + lenScore;

        if (score < bestScore) {
            bestScore = score;
            best = cand;
        }
    }

    return best;
}

function chooseBestChineseAnswer(translations, difficultyLevel) {
    var raw = Array.isArray(translations) ? translations : [];
    var list = [];
    for (var i = 0; i < raw.length; i++) {
        var part = splitAnswerCandidatesFromText(raw[i]);
        for (var j = 0; j < part.length; j++) list.push(part[j]);
    }
    list = uniqueStrings(list);

    var best = '';
    var bestScore = Number.POSITIVE_INFINITY;

    for (var t = 0; t < list.length; t++) {
        var cand = list[t];
        var entry = lookupZhWord(cand);

        if (entry && entry.l && !isLevelAllowed(entry.l, difficultyLevel)) {
            continue;
        }

        var rankScore = entry ? Number(entry.r) || 999999 : 900000;
        var lenScore = String(cand).length * 0.5;
        var score = rankScore + lenScore;

        if (score < bestScore) {
            bestScore = score;
            best = cand;
        }
    }

    return best;
}

function buildAcceptableAnswers(allCandidates, mainAnswer) {
    var list = Array.isArray(allCandidates) ? allCandidates.slice() : [];
    var main = String(mainAnswer || '')
        .trim()
        .toLowerCase();
    var out = [];
    var seen = {};

    for (var i = 0; i < list.length; i++) {
        var v = String(list[i] || '').trim();
        if (!v) continue;
        var k = v.toLowerCase();
        if (k === main) continue;
        if (seen[k]) continue;
        seen[k] = true;
        out.push(v);
    }

    return out;
}

function resolveWrongBookItemLevel(item) {
    if (!item) return '';
    var type = String(item.type || '');
    var answer = String(item.answer || '');
    var question = String(item.question || '');

    if (type === 'cn_to_en') {
        var enCand = splitAnswerCandidatesFromText(answer);
        for (var i = 0; i < enCand.length; i++) {
            var enEntry = lookupEnWord(enCand[i]);
            if (enEntry && enEntry.l) return String(enEntry.l);
        }

        var zhMatch = question.match(/[：:]\s*(.+)$/);
        if (zhMatch && zhMatch[1]) {
            var zhEntry = lookupZhWord(String(zhMatch[1]).trim());
            if (zhEntry && zhEntry.l) return String(zhEntry.l);
        }
    }

    if (type === 'en_to_cn') {
        var zhCand = splitAnswerCandidatesFromText(answer);
        for (var j = 0; j < zhCand.length; j++) {
            var zEntry = lookupZhWord(zhCand[j]);
            if (zEntry && zEntry.l) return String(zEntry.l);
        }

        var enMatch = question.match(/[：:]\s*(.+)$/);
        if (enMatch && enMatch[1]) {
            var enWord = String(enMatch[1]).trim();
            var enEntry2 = lookupEnWord(enWord);
            if (enEntry2 && enEntry2.l) return String(enEntry2.l);
        }
    }

    return '';
}

function isWrongBookItemAllowed(item, difficultyLevel, enabledTypes) {
    if (!item) return false;

    var type = String(item.type || 'cn_to_en');
    var types = Array.isArray(enabledTypes) ? enabledTypes : ['cn_to_en', 'en_to_cn'];
    if (types.indexOf(type) < 0) return false;

    var level = resolveWrongBookItemLevel(item);
    if (!level) {
        return !isLowDifficulty(difficultyLevel);
    }

    return isLevelAllowed(level, difficultyLevel);
}

/**
 * 从错题本中选一道到期的题
 * @param {object[]} wrongBook
 * @param {number} wrongBookPriority - 0~100
 * @param {string} difficultyLevel
 * @param {string[]} enabledTypes
 * @returns {object|null} challenge 或 null
 */
function tryPickFromWrongBook(wrongBook, wrongBookPriority, difficultyLevel, enabledTypes) {
    if (!Array.isArray(wrongBook) || wrongBook.length === 0) return null;
    if (Math.random() * 100 >= wrongBookPriority) return null;

    var now = Date.now();
    var due = [];
    for (var i = 0; i < wrongBook.length; i++) {
        var item = wrongBook[i];
        if (!item) continue;
        if (Number(item.dueAt || 0) > now) continue;
        if (!isWrongBookItemAllowed(item, difficultyLevel, enabledTypes)) continue;
        due.push(item);
    }

    if (due.length === 0) return null;

    var pick = due[Math.floor(Math.random() * due.length)];
    var answer = String(pick.answer || '');
    var type = String(pick.type || 'cn_to_en');

    var reloaded = [];
    if (type === 'cn_to_en') {
        var answerCandidates = splitAnswerCandidatesFromText(answer);
        for (var ai = 0; ai < answerCandidates.length; ai++) {
            var enEntry = lookupEnWord(answerCandidates[ai]);
            if (enEntry && Array.isArray(enEntry.a)) reloaded = reloaded.concat(enEntry.a);
        }
    } else if (type === 'en_to_cn') {
        var zhCandidates = splitAnswerCandidatesFromText(answer);
        for (var zi = 0; zi < zhCandidates.length; zi++) {
            var zhEntry = lookupZhWord(zhCandidates[zi]);
            if (zhEntry && Array.isArray(zhEntry.a)) reloaded = reloaded.concat(zhEntry.a);
        }
    }

    var qText = String(pick.question || '');
    var wordMatch = qText.match(/[：:]\s*(.+)$/);
    if (wordMatch) {
        var origWord = String(wordMatch[1]).trim();
        if (type === 'cn_to_en') {
            var zhLookup = lookupZhWord(origWord);
            if (zhLookup && Array.isArray(zhLookup.t)) reloaded = reloaded.concat(zhLookup.t);
        } else {
            var enLookup = lookupEnWord(origWord);
            if (enLookup && Array.isArray(enLookup.t)) reloaded = reloaded.concat(enLookup.t);
        }
    }

    reloaded = uniqueStrings(reloaded);

    return {
        type: type,
        question: String(pick.question || ''),
        answer: answer,
        acceptableAnswers: reloaded,
        source: 'wrongbook',
        vocabEntry: null,
    };
}

/**
 * 从文本上下文中出一道题
 */
function buildContextChallenge(textCandidates, difficultyLevel, enabledTypes, excludeSet) {
    var types = enabledTypes || ['cn_to_en', 'en_to_cn'];

    var shuffledTypes = types.slice();
    for (var s = shuffledTypes.length - 1; s > 0; s--) {
        var r = Math.floor(Math.random() * (s + 1));
        var tmp = shuffledTypes[s];
        shuffledTypes[s] = shuffledTypes[r];
        shuffledTypes[r] = tmp;
    }

    for (var t = 0; t < shuffledTypes.length; t++) {
        var type = shuffledTypes[t];

        if (type === 'cn_to_en') {
            var zhFiltered = filterByDifficulty(textCandidates.zh, 'zh', difficultyLevel);
            if (excludeSet) {
                zhFiltered = zhFiltered.filter(function (e) {
                    var tList = e.t || [];
                    for (var ti = 0; ti < tList.length; ti++) {
                        if (excludeSet[String(tList[ti]).toLowerCase()]) return false;
                    }
                    return !excludeSet[String(e.w).toLowerCase()];
                });
            }

            if (zhFiltered.length > 0) {
                var zhPick = zhFiltered[Math.floor(Math.random() * zhFiltered.length)];
                var translations = Array.isArray(zhPick.t) ? zhPick.t.slice() : [];
                var mainAnswer = chooseBestEnglishAnswer(translations, difficultyLevel);

                if (mainAnswer) {
                    var acceptable = buildAcceptableAnswers(translations, mainAnswer);
                    var enCheck = lookupEnWord(mainAnswer);
                    if (enCheck && Array.isArray(enCheck.a)) {
                        acceptable = acceptable.concat(enCheck.a);
                    }
                    acceptable = uniqueStrings(acceptable);

                    return {
                        type: 'cn_to_en',
                        question: '把这个中文词翻译成英文：' + String(zhPick.w),
                        answer: mainAnswer,
                        acceptableAnswers: acceptable,
                        source: 'context',
                        vocabEntry: zhPick,
                    };
                }
            }
        }

        if (type === 'en_to_cn') {
            var enFiltered = filterByDifficulty(textCandidates.en, 'en', difficultyLevel);
            if (excludeSet) {
                enFiltered = enFiltered.filter(function (e) {
                    return !excludeSet[String(e.w).toLowerCase()];
                });
            }

            if (enFiltered.length > 0) {
                var enPick = enFiltered[Math.floor(Math.random() * enFiltered.length)];
                var zhTranslations = Array.isArray(enPick.t) ? enPick.t.slice() : [];
                var mainZh = chooseBestChineseAnswer(zhTranslations, difficultyLevel);

                if (mainZh) {
                    var acceptableZh = buildAcceptableAnswers(zhTranslations, mainZh);
                    var zhCheck = lookupZhWord(mainZh);
                    if (zhCheck && Array.isArray(zhCheck.a)) {
                        acceptableZh = acceptableZh.concat(zhCheck.a);
                    }
                    acceptableZh = uniqueStrings(acceptableZh);

                    return {
                        type: 'en_to_cn',
                        question: '把这个英文词翻译成中文：' + String(enPick.w),
                        answer: mainZh,
                        acceptableAnswers: acceptableZh,
                        source: 'context',
                        vocabEntry: enPick,
                    };
                }
            }
        }
    }

    return null;
}

/**
 * 从全词库随机出题（无上下文时的回退）
 */
function buildRandomChallenge(difficultyLevel, enabledTypes, excludeSet) {
    var types = enabledTypes || ['cn_to_en', 'en_to_cn'];
    var type = types[Math.floor(Math.random() * types.length)];

    if (type === 'cn_to_en') {
        var zhEntry = pickRandomByDifficulty('zh', difficultyLevel);
        if (
            zhEntry &&
            zhEntry.t &&
            zhEntry.t.length > 0 &&
            !(excludeSet && excludeSet[String(zhEntry.w).toLowerCase()])
        ) {
            var mainEn = chooseBestEnglishAnswer(zhEntry.t, difficultyLevel);
            if (mainEn) {
                var accEn = buildAcceptableAnswers(zhEntry.t, mainEn);
                var enLookup = lookupEnWord(mainEn);
                if (enLookup && Array.isArray(enLookup.a)) {
                    accEn = accEn.concat(enLookup.a);
                }
                accEn = uniqueStrings(accEn);

                return {
                    type: 'cn_to_en',
                    question: '把这个中文词翻译成英文：' + String(zhEntry.w),
                    answer: mainEn,
                    acceptableAnswers: accEn,
                    source: 'random',
                    vocabEntry: zhEntry,
                };
            }
        }
    }

    var enEntry = pickRandomByDifficulty('en', difficultyLevel);
    if (
        enEntry &&
        enEntry.t &&
        enEntry.t.length > 0 &&
        !(excludeSet && excludeSet[String(enEntry.w).toLowerCase()])
    ) {
        var mainZh = chooseBestChineseAnswer(enEntry.t, difficultyLevel);
        if (mainZh) {
            var accZh = buildAcceptableAnswers(enEntry.t, mainZh);
            var zhLookup = lookupZhWord(mainZh);
            if (zhLookup && Array.isArray(zhLookup.a)) {
                accZh = accZh.concat(zhLookup.a);
            }
            accZh = uniqueStrings(accZh);

            return {
                type: 'en_to_cn',
                question: '把这个英文词翻译成中文：' + String(enEntry.w),
                answer: mainZh,
                acceptableAnswers: accZh,
                source: 'random',
                vocabEntry: enEntry,
            };
        }
    }

    return null;
}

/**
 * 主出题函数
 * @param {string} text - AI 消息文本
 * @param {object} settings - 插件设置
 * @returns {Promise<object>} challenge
 */
export async function generateChallenge(text, settings, excludeWords) {
    await ensureLoaded();

    var difficultyLevel = String(settings.difficultyLevel || 'intermediate');
    var wrongBookPriority = Number(settings.wrongBookPriority || 30);
    var enabledTypes = settings.challengeTypes || ['cn_to_en', 'en_to_cn'];
    var wrongBook = settings.wrongBook || [];

    var fromWrongBook = tryPickFromWrongBook(
        wrongBook,
        wrongBookPriority,
        difficultyLevel,
        enabledTypes
    );
    if (fromWrongBook) return fromWrongBook;

    var excludeSet = {};
    if (Array.isArray(excludeWords)) {
        for (var ex = 0; ex < excludeWords.length; ex++) {
            excludeSet[String(excludeWords[ex]).toLowerCase()] = true;
        }
    }

    if (text && String(text).trim().length > 10) {
        var candidates = await processText(text);
        var contextChallenge = buildContextChallenge(
            candidates,
            difficultyLevel,
            enabledTypes,
            excludeSet
        );
        if (contextChallenge) return contextChallenge;
    }

    return buildRandomChallenge(difficultyLevel, enabledTypes, excludeSet);
}
