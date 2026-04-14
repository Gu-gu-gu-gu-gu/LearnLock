/**
 * 词频难度分级：加载本地词库，按频率排名筛选
 */

var vocabEn = null;
var vocabZh = null;
var indexEn = null;
var indexZh = null;

function getBaseUrl() {
    return new URL('../', import.meta.url).href;
}

async function loadVocabData() {
    if (vocabEn && vocabZh) return;

    var base = getBaseUrl();

    // 1. 尝试加载 ECDICT 核心词库（大词库）
    var ecdictEntries = [];
    try {
        var resEc = await fetch(base + 'data/ecdict-core.json', { cache: 'force-cache' });
        if (resEc.ok) {
            ecdictEntries = await resEc.json();
            console.log('[LearnLock] ecdict-core.json 已加载，词条数:', ecdictEntries.length);
        }
    } catch (e) {
        console.warn('[LearnLock] ecdict-core.json 加载失败（将使用精简词库）:', e);
    }

    // 2. 加载手工精简英文词库（作为覆盖层，保留手写别名）
    var manualEn = [];
    try {
        var resEn = await fetch(base + 'data/vocab-en.json', { cache: 'force-cache' });
        manualEn = await resEn.json();
    } catch (e) {
        console.warn('[LearnLock] vocab-en.json 加载失败:', e);
    }

    // 3. 合并索引：ECDICT 为基底，手工词库覆盖（别名、翻译更精准）
    indexEn = {};
    for (var ei = 0; ei < ecdictEntries.length; ei++) {
        var ec = ecdictEntries[ei];
        indexEn[String(ec.w).toLowerCase()] = ec;
    }
    for (var mi = 0; mi < manualEn.length; mi++) {
        var me = manualEn[mi];
        var key = String(me.w).toLowerCase();
        if (indexEn[key]) {
            // 合并：手工别名 + ECDICT 音标/释义
            var existing = indexEn[key];
            if (Array.isArray(me.a) && me.a.length > 0) existing.a = me.a;
            if (Array.isArray(me.t) && me.t.length > 0) existing.t = me.t;
            if (me.l) existing.l = me.l;
            if (me.p) existing.p = me.p;
        } else {
            indexEn[key] = me;
        }
    }
    vocabEn = Object.values(indexEn);

    // 4. 从英文词库反向自动生成中文索引（按词频排序，最常用英文词排前面）
    indexZh = {};
    var sortedForReverse = vocabEn.slice().sort(function (a, b) {
        return (Number(a.r) || 99999) - (Number(b.r) || 99999);
    });
    for (var ri = 0; ri < sortedForReverse.length; ri++) {
        var revEn = sortedForReverse[ri];
        if (!revEn || !Array.isArray(revEn.t)) continue;
        for (var rti = 0; rti < revEn.t.length; rti++) {
            var revZh = String(revEn.t[rti] || '').trim();
            if (!revZh || revZh.length < 2) continue;
            var allCjk = true;
            for (var rci = 0; rci < revZh.length; rci++) {
                var rcc = revZh.charCodeAt(rci);
                if (rcc < 0x4e00 || rcc > 0x9fff) {
                    allCjk = false;
                    break;
                }
            }
            if (!allCjk) continue;
            if (indexZh[revZh]) {
                var exZh = indexZh[revZh];
                var enW = String(revEn.w || '');
                if (exZh.t.indexOf(enW) < 0) exZh.t.push(enW);
            } else {
                indexZh[revZh] = {
                    w: revZh,
                    t: [String(revEn.w || '')],
                    a: [],
                    l: revEn.l || 'B1',
                    p: revEn.p || '',
                    r: Number(revEn.r) || 0,
                };
            }
        }
    }

    // 5. 加载手工中文词库作为覆盖层（可选，不存在也没关系）
    var manualZh = [];
    try {
        var resZh = await fetch(base + 'data/vocab-zh.json', { cache: 'force-cache' });
        manualZh = await resZh.json();
        console.log('[LearnLock] vocab-zh.json 手工覆盖层已加载，词条数:', manualZh.length);
    } catch (e) {
        // vocab-zh.json 不存在也没关系，已有反向生成的数据
    }
    for (var mzi = 0; mzi < manualZh.length; mzi++) {
        var mz = manualZh[mzi];
        var mzKey = String(mz.w);
        if (indexZh[mzKey]) {
            if (Array.isArray(mz.t) && mz.t.length > 0) indexZh[mzKey].t = mz.t;
            if (Array.isArray(mz.a) && mz.a.length > 0) indexZh[mzKey].a = mz.a;
            if (mz.l) indexZh[mzKey].l = mz.l;
            if (mz.p) indexZh[mzKey].p = mz.p;
        } else {
            indexZh[mzKey] = mz;
        }
    }
    vocabZh = Object.values(indexZh);
    console.log('[LearnLock] 中文词条总数:', vocabZh.length, '(含反向生成)');
}

export async function ensureLoaded() {
    await loadVocabData();
}

/**
 * 查英文词条
 * @returns {object|null} vocab entry or null
 */
export function lookupEnWord(word) {
    if (!indexEn) return null;
    return indexEn[String(word).toLowerCase()] || null;
}

/**
 * 查中文词条
 * @returns {object|null} vocab entry or null
 */
export function lookupZhWord(word) {
    if (!indexZh) return null;
    return indexZh[String(word)] || null;
}

/**
 * 难度等级定义
 * beginner   = A1
 * elementary = A2
 * intermediate = B1
 * upper      = B2
 * advanced   = C1
 */
var levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1'];

/**
 * 根据难度设置筛选词表中的词
 * @param {string[]} candidates - 候选词列表
 * @param {string} lang - 'en' 或 'zh'
 * @param {string} difficultyLevel - 设置中的难度等级
 * @returns {object[]} 符合难度的词条数组
 */
export function filterByDifficulty(candidates, lang, difficultyLevel) {
    var levelMap = {
        beginner: ['A1'],
        elementary: ['A1', 'A2'],
        intermediate: ['A1', 'A2', 'B1'],
        upper: ['A2', 'B1', 'B2'],
        advanced: ['B1', 'B2', 'C1'],
        challenge: ['B2', 'C1'],
    };

    var allowedLevels = levelMap[difficultyLevel] || ['A1', 'A2', 'B1'];
    var allowedSet = {};
    for (var a = 0; a < allowedLevels.length; a++) {
        allowedSet[allowedLevels[a]] = true;
    }

    var lookupFn = lang === 'en' ? lookupEnWord : lookupZhWord;
    var results = [];

    for (var i = 0; i < candidates.length; i++) {
        var entry = lookupFn(candidates[i]);
        if (!entry) continue;
        if (!allowedSet[entry.l]) continue;
        results.push(entry);
    }

    return results;
}

/**
 * 获取全部词库（用于非上下文出题）
 */
export function getAllEntries(lang) {
    if (lang === 'en') return vocabEn || [];
    return vocabZh || [];
}

/**
 * 按难度从全词库中随机抽一个
 */
export function pickRandomByDifficulty(lang, difficultyLevel) {
    var all = getAllEntries(lang);
    var allWords = [];
    for (var i = 0; i < all.length; i++) {
        allWords.push(String(all[i].w || ''));
    }
    var filtered = filterByDifficulty(allWords, lang, difficultyLevel);
    if (filtered.length === 0) return null;
    return filtered[Math.floor(Math.random() * filtered.length)];
}
