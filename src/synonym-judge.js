/**
 * 同义词判题器
 * 支持严格模式和宽松模式
 */

import { lookupEnWord, lookupZhWord } from './difficulty.js';

function normalizeForCompare(s) {
    var out = '';
    var lower = String(s || '').toLowerCase();
    for (var i = 0; i < lower.length; i++) {
        var c = lower.charCodeAt(i);
        var isLetter = c >= 97 && c <= 122;
        var isDigit = c >= 48 && c <= 57;
        var isCjk = c >= 0x4e00 && c <= 0x9fff;
        if (isLetter || isDigit || isCjk) out += lower.charAt(i);
    }
    return out;
}

/**
 * 剥离中文常见语法后缀，用于模糊匹配
 */
function stripChineseSuffix(s) {
    var text = String(s || '');
    // 常见助词/后缀：的 了 着 过 地 得 们 儿 子 化 性 式 型
    text = text.replace(/[的了着过地得们儿]$/g, '');
    return text;
}

/**
 * 判断两个中文答案是否"模糊相等"
 * 支持：去后缀匹配 + 子串包含匹配
 */
function fuzzyMatchChinese(userNorm, candidateNorm) {
    if (!userNorm || !candidateNorm) return false;
    if (userNorm === candidateNorm) return true;

    var userStripped = stripChineseSuffix(userNorm);
    var candStripped = stripChineseSuffix(candidateNorm);

    if (userStripped && candStripped && userStripped === candStripped) return true;

    // 子串包含（至少2个字）
    if (userNorm.length >= 2 && candidateNorm.length >= 2) {
        if (candidateNorm.indexOf(userNorm) >= 0) return true;
        if (userNorm.indexOf(candidateNorm) >= 0) return true;
    }
    if (userStripped.length >= 2 && candStripped.length >= 2) {
        if (candStripped.indexOf(userStripped) >= 0) return true;
        if (userStripped.indexOf(candStripped) >= 0) return true;
    }

    return false;
}

/**
 * 收集一个词条的所有可接受答案
 * @param {string} correctAnswer - 标准答案
 * @param {string} challengeType - 'cn_to_en' 或 'en_to_cn'
 * @returns {string[]} 所有可接受的标准化答案
 */
function collectAcceptableAnswers(correctAnswer, challengeType) {
    var answers = [normalizeForCompare(correctAnswer)];

    if (challengeType === 'cn_to_en') {
        // 标准答案是英文，去英文词库找同义词
        var enEntry = lookupEnWord(correctAnswer);
        if (enEntry) {
            // 同义词
            if (Array.isArray(enEntry.a)) {
                for (var i = 0; i < enEntry.a.length; i++) {
                    answers.push(normalizeForCompare(enEntry.a[i]));
                }
            }
        }

        // 也去中文词库里搜，看有没有指向同一组英文翻译的
        // （比如"机会"的翻译列表包含 chance 和 opportunity）
        // 这在 challenge-engine 出题时已经绑定了，这里做兜底
    }

    if (challengeType === 'en_to_cn') {
        // 标准答案是中文，去中文词库找同义词
        var zhEntry = lookupZhWord(correctAnswer);
        if (zhEntry) {
            if (Array.isArray(zhEntry.a)) {
                for (var j = 0; j < zhEntry.a.length; j++) {
                    answers.push(normalizeForCompare(zhEntry.a[j]));
                }
            }
        }

        // 也去英文词库找，看英文题目词的中文翻译列表
        // （兜底：比如 opportunity 的翻译列表里有"机遇""契机"等）
    }

    // 去重
    var seen = {};
    var unique = [];
    for (var k = 0; k < answers.length; k++) {
        if (!answers[k]) continue;
        if (seen[answers[k]]) continue;
        seen[answers[k]] = true;
        unique.push(answers[k]);
    }

    return unique;
}

/**
 * 判题
 * @param {string} userAnswer - 用户输入
 * @param {string} correctAnswer - 标准答案
 * @param {string} challengeType - 'cn_to_en' 或 'en_to_cn'
 * @param {string} synonymMode - 'strict' 或 'loose'
 * @param {string[]} [extraAcceptable] - 额外可接受答案（来自出题时绑定）
 * @returns {{ correct: boolean, feedback: string }}
 */
export function judgeAnswer(
    userAnswer,
    correctAnswer,
    challengeType,
    synonymMode,
    extraAcceptable
) {
    var normalizedUser = normalizeForCompare(userAnswer);

    if (!normalizedUser) {
        return { correct: false, feedback: '请输入答案' };
    }

    // 精确匹配
    var normalizedCorrect = normalizeForCompare(correctAnswer);
    if (normalizedUser === normalizedCorrect) {
        return { correct: true, feedback: '完全正确！' };
    }

    // 严格模式到此为止
    if (synonymMode === 'strict') {
        return { correct: false, feedback: '答案不正确。标准答案：' + String(correctAnswer) };
    }

    // 宽松模式：检查同义词
    var acceptable = collectAcceptableAnswers(correctAnswer, challengeType);

    // 加上出题时绑定的额外答案
    if (Array.isArray(extraAcceptable)) {
        for (var i = 0; i < extraAcceptable.length; i++) {
            var norm = normalizeForCompare(extraAcceptable[i]);
            if (norm) acceptable.push(norm);
        }
    }

    // 精确同义词匹配
    for (var j = 0; j < acceptable.length; j++) {
        if (normalizedUser === acceptable[j]) {
            return {
                correct: true,
                feedback: '回答正确（同义词）！更常用的表达：' + String(correctAnswer),
            };
        }
    }

    // 中文模糊匹配（去后缀 + 子串）
    var userHasCjk = false;
    for (var ci = 0; ci < normalizedUser.length; ci++) {
        var cc = normalizedUser.charCodeAt(ci);
        if (cc >= 0x4e00 && cc <= 0x9fff) {
            userHasCjk = true;
            break;
        }
    }
    if (userHasCjk) {
        // 先对标准答案做模糊
        if (fuzzyMatchChinese(normalizedUser, normalizedCorrect)) {
            return {
                correct: true,
                feedback: '回答正确！标准写法：' + String(correctAnswer),
            };
        }
        // 再对所有可接受答案做模糊
        for (var fj = 0; fj < acceptable.length; fj++) {
            if (fuzzyMatchChinese(normalizedUser, acceptable[fj])) {
                return {
                    correct: true,
                    feedback: '回答正确（近义表达）！更标准的写法：' + String(correctAnswer),
                };
            }
        }
    }

    return {
        correct: false,
        feedback: '答案不正确。标准答案：' + String(correctAnswer),
    };
}
