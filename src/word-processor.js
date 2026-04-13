/**
 * 从文本中抽词 + 过滤垃圾词
 */

var enStopwords = null;
var zhStopwords = null;

function getBaseUrl() {
    return new URL('../', import.meta.url).href;
}

async function loadStopwords() {
    if (enStopwords && zhStopwords) return;

    var base = getBaseUrl();
    try {
        var enRes = await fetch(base + 'data/en-stopwords.json', { cache: 'force-cache' });
        var enArr = await enRes.json();
        enStopwords = new Set(enArr.map(function (w) { return String(w).toLowerCase(); }));
    } catch (e) {
        console.warn('[LearnLock] 英文停用词加载失败:', e);
        enStopwords = new Set();
    }

    try {
        var zhRes = await fetch(base + 'data/zh-stopwords.json', { cache: 'force-cache' });
        var zhArr = await zhRes.json();
        zhStopwords = new Set(zhArr.map(function (w) { return String(w); }));
    } catch (e) {
        console.warn('[LearnLock] 中文停用词加载失败:', e);
        zhStopwords = new Set();
    }
}

function isChineseChar(c) {
    var code = c.charCodeAt(0);
    return code >= 0x4e00 && code <= 0x9fff;
}

function isEnglishLetter(c) {
    var code = c.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * 从文本中提取英文单词候选
 */
function extractEnglishWords(text) {
    var matches = String(text || '').match(/[a-zA-Z][a-zA-Z'-]{1,30}[a-zA-Z]/g);
    if (!matches) return [];

    var seen = {};
    var result = [];
    for (var i = 0; i < matches.length; i++) {
        var w = matches[i].toLowerCase().replace(/^['-]+|['-]+$/g, '');
        if (w.length < 3) continue;
        if (w.length > 25) continue;
        if (seen[w]) continue;
        seen[w] = true;
        result.push(w);
    }
    return result;
}

/**
 * 从文本中提取中文词组候选（简单连续汉字切割）
 */
function extractChineseWords(text) {
    var s = String(text || '');
    var segments = [];
    var buffer = '';

    for (var i = 0; i < s.length; i++) {
        if (isChineseChar(s[i])) {
            buffer += s[i];
        } else {
            if (buffer.length >= 2) segments.push(buffer);
            buffer = '';
        }
    }
    if (buffer.length >= 2) segments.push(buffer);

    // 从长连续汉字中切出 2~4 字的候选
    var candidates = {};
    for (var si = 0; si < segments.length; si++) {
        var seg = segments[si];
        for (var len = 2; len <= Math.min(4, seg.length); len++) {
            for (var start = 0; start <= seg.length - len; start++) {
                var word = seg.substring(start, start + len);
                candidates[word] = true;
            }
        }
    }

    return Object.keys(candidates);
}

/**
 * 过滤停用词和低质量候选
 */
function filterCandidates(words, lang) {
    var stopSet = (lang === 'en') ? enStopwords : zhStopwords;
    if (!stopSet) stopSet = new Set();

    var result = [];
    for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var check = (lang === 'en') ? w.toLowerCase() : w;
        if (stopSet.has(check)) continue;
        result.push(w);
    }
    return result;
}

export async function processText(text) {
    await loadStopwords();

    var rawEn = extractEnglishWords(text);
    var rawZh = extractChineseWords(text);

    var filteredEn = filterCandidates(rawEn, 'en');
    var filteredZh = filterCandidates(rawZh, 'zh');

    return {
        en: filteredEn,
        zh: filteredZh
    };
}
