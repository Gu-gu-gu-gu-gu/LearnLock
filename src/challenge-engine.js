/**
 * 出题引擎：从文本抽词、按难度筛选、混合错题、生成题目
 */

import { processText } from './word-processor.js';
import {
    ensureLoaded,
    filterByDifficulty,
    lookupEnWord,
    lookupZhWord,
    pickRandomByDifficulty
} from './difficulty.js';

/**
 * 从错题本中选一道到期的题
 * @param {object[]} wrongBook
 * @param {number} wrongBookPriority - 0~100
 * @returns {object|null} challenge 或 null
 */
function tryPickFromWrongBook(wrongBook, wrongBookPriority) {
    if (!Array.isArray(wrongBook) || wrongBook.length === 0) return null;
    if (Math.random() * 100 >= wrongBookPriority) return null;

    var now = Date.now();
    var due = [];
    for (var i = 0; i < wrongBook.length; i++) {
        var item = wrongBook[i];
        if (item && Number(item.dueAt || 0) <= now) {
            due.push(item);
        }
    }

    if (due.length === 0) return null;

    var pick = due[Math.floor(Math.random() * due.length)];
    var answer = String(pick.answer || '');
    var type = String(pick.type || 'cn_to_en');

    // 重新查词库补全可接受答案
    var reloaded = [];
    if (type === 'cn_to_en') {
        var enEntry = lookupEnWord(answer);
        if (enEntry && Array.isArray(enEntry.a)) reloaded = reloaded.concat(enEntry.a);
    } else if (type === 'en_to_cn') {
        var zhEntry = lookupZhWord(answer);
        if (zhEntry && Array.isArray(zhEntry.a)) reloaded = reloaded.concat(zhEntry.a);
    }

    // 从题干里提取原始词，查翻译列表作为额外答案
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

    return {
        type: type,
        question: String(pick.question || ''),
        answer: answer,
        acceptableAnswers: reloaded,
        source: 'wrongbook',
        vocabEntry: null
    };
}

/**
 * 从文本上下文中出一道题
 */
function buildContextChallenge(textCandidates, difficultyLevel, enabledTypes, excludeSet) {
    var types = enabledTypes || ['cn_to_en', 'en_to_cn'];

    // 打乱类型顺序
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
            // 从中文候选中找有词库条目的
            var zhFiltered = filterByDifficulty(textCandidates.zh, 'zh', difficultyLevel);
            // 排除已出过的词
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
                var translations = zhPick.t || [];
                if (translations.length > 0) {
                    var mainAnswer = translations[0];
                    var acceptable = translations.slice(1);
                    // 加上英文同义词
                    var enCheck = lookupEnWord(mainAnswer);
                    if (enCheck && Array.isArray(enCheck.a)) {
                        acceptable = acceptable.concat(enCheck.a);
                    }
                    return {
                        type: 'cn_to_en',
                        question: '把这个中文词翻译成英文：' + String(zhPick.w),
                        answer: mainAnswer,
                        acceptableAnswers: acceptable,
                        source: 'context',
                        vocabEntry: zhPick
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
                var zhTranslations = enPick.t || [];
                if (zhTranslations.length > 0) {
                    var mainZh = zhTranslations[0];
                    var acceptableZh = zhTranslations.slice(1);
                    // 加上中文同义词
                    var zhCheck = lookupZhWord(mainZh);
                    if (zhCheck && Array.isArray(zhCheck.a)) {
                        acceptableZh = acceptableZh.concat(zhCheck.a);
                    }
                    return {
                        type: 'en_to_cn',
                        question: '把这个英文词翻译成中文：' + String(enPick.w),
                        answer: mainZh,
                        acceptableAnswers: acceptableZh,
                        source: 'context',
                        vocabEntry: enPick
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
        if (zhEntry && zhEntry.t && zhEntry.t.length > 0 && !(excludeSet && excludeSet[String(zhEntry.w).toLowerCase()])) {
            var mainEn = zhEntry.t[0];
            var accEn = zhEntry.t.slice(1);
            var enLookup = lookupEnWord(mainEn);
            if (enLookup && Array.isArray(enLookup.a)) {
                accEn = accEn.concat(enLookup.a);
            }
            return {
                type: 'cn_to_en',
                question: '把这个中文词翻译成英文：' + String(zhEntry.w),
                answer: mainEn,
                acceptableAnswers: accEn,
                source: 'random',
                vocabEntry: zhEntry
            };
        }
    }

    var enEntry = pickRandomByDifficulty('en', difficultyLevel);
    if (enEntry && enEntry.t && enEntry.t.length > 0 && !(excludeSet && excludeSet[String(enEntry.w).toLowerCase()])) {
        var mainZh = enEntry.t[0];
        var accZh = enEntry.t.slice(1);
        var zhLookup = lookupZhWord(mainZh);
        if (zhLookup && Array.isArray(zhLookup.a)) {
            accZh = accZh.concat(zhLookup.a);
        }
        return {
            type: 'en_to_cn',
            question: '把这个英文词翻译成中文：' + String(enEntry.w),
            answer: mainZh,
            acceptableAnswers: accZh,
            source: 'random',
            vocabEntry: enEntry
        };
    }

    // 词库全空时返回 null，由调用方处理
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

    // 1) 优先从错题本出题（按概率）
    var fromWrongBook = tryPickFromWrongBook(wrongBook, wrongBookPriority);
    if (fromWrongBook) return fromWrongBook;

    // 构建排除集合
    var excludeSet = {};
    if (Array.isArray(excludeWords)) {
        for (var ex = 0; ex < excludeWords.length; ex++) {
            excludeSet[String(excludeWords[ex]).toLowerCase()] = true;
        }
    }

    // 2) 从文本上下文抽词出题
    if (text && String(text).trim().length > 10) {
        var candidates = await processText(text);
        var contextChallenge = buildContextChallenge(candidates, difficultyLevel, enabledTypes, excludeSet);
        if (contextChallenge) return contextChallenge;
    }

    // 3) 全词库随机
    return buildRandomChallenge(difficultyLevel, enabledTypes, excludeSet);
}
