/**
 * 词典查询：在线API + 离线词库回退
 */

import { lookupEnWord, lookupZhWord } from './difficulty.js';

var onlineCache = {};

/**
 * 在线查英文词（dictionaryapi.dev）
 * 返回 { phonetic, definition, example } 或 null
 */
async function fetchOnlineEnglish(word) {
    var key = 'en:' + String(word).toLowerCase();
    if (onlineCache[key] !== undefined) return onlineCache[key];

    try {
        var url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word);
        var res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) {
            onlineCache[key] = null;
            return null;
        }
        var data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            onlineCache[key] = null;
            return null;
        }

        var entry = data[0];
        var phonetic = '';
        if (entry.phonetic) {
            phonetic = entry.phonetic;
        } else if (Array.isArray(entry.phonetics)) {
            for (var p = 0; p < entry.phonetics.length; p++) {
                if (entry.phonetics[p].text) {
                    phonetic = entry.phonetics[p].text;
                    break;
                }
            }
        }

        var definition = '';
        var example = '';
        if (Array.isArray(entry.meanings) && entry.meanings.length > 0) {
            var m = entry.meanings[0];
            if (Array.isArray(m.definitions) && m.definitions.length > 0) {
                definition = String(m.definitions[0].definition || '');
                example = String(m.definitions[0].example || '');
            }
        }

        var audioUrl = '';
        if (Array.isArray(entry.phonetics)) {
            for (var a = 0; a < entry.phonetics.length; a++) {
                if (entry.phonetics[a].audio) {
                    audioUrl = entry.phonetics[a].audio;
                    break;
                }
            }
        }

        var result = {
            word: String(entry.word || word),
            phonetic: phonetic,
            definition: definition,
            example: example,
            audioUrl: audioUrl
        };

        onlineCache[key] = result;
        return result;
    } catch (e) {
        console.warn('[LearnLock] 在线查词失败:', word, e);
        onlineCache[key] = null;
        return null;
    }
}

/**
 * 综合查词（先查本地词库，再查在线API增强）
 * @param {string} word
 * @param {string} lang - 'en' 或 'zh'
 * @returns {object} 查词结果
 */
export async function lookup(word, lang) {
    var result = {
        word: word,
        lang: lang,
        found: false,
        translations: [],
        aliases: [],
        level: '',
        rank: 0,
        pos: '',
        phonetic: '',
        definition: '',
        example: '',
        audioUrl: ''
    };

    if (lang === 'en') {
        var enEntry = lookupEnWord(word);
        if (enEntry) {
            result.found = true;
            result.translations = enEntry.t || [];
            result.aliases = enEntry.a || [];
            result.level = enEntry.l || '';
            result.rank = enEntry.r || 0;
            result.pos = enEntry.p || '';
            // ECDICT 离线数据：音标、英文释义
            if (enEntry.ph) result.phonetic = enEntry.ph;
            if (enEntry.d) result.definition = enEntry.d;
            // ECDICT tags（考试标签）
            if (Array.isArray(enEntry.tags) && enEntry.tags.length > 0) {
                result.tags = enEntry.tags;
            }
        }

        // 仅在缺少音标或释义时才尝试在线增强（减少不必要的网络请求）
        var needOnline = !result.phonetic || !result.definition;
        if (needOnline) {
            try {
                var online = await fetchOnlineEnglish(word);
                if (online) {
                    result.found = true;
                    if (!result.phonetic && online.phonetic) result.phonetic = online.phonetic;
                    if (!result.definition && online.definition) result.definition = online.definition;
                    if (online.example) result.example = online.example;
                    if (online.audioUrl) result.audioUrl = online.audioUrl;
                }
            } catch (_onlineErr) {
                // 离线环境下静默失败，已有 ECDICT 数据兜底
            }
        } else {
            // 有离线数据也尝试获取音频和例句（非阻塞）
            fetchOnlineEnglish(word).then(function (online) {
                if (!online) return;
                if (online.audioUrl) result.audioUrl = online.audioUrl;
                if (online.example) result.example = online.example;
            }).catch(function () {});
        }
    } else {
        var zhEntry = lookupZhWord(word);
        if (zhEntry) {
            result.found = true;
            result.translations = zhEntry.t || [];
            result.aliases = zhEntry.a || [];
            result.level = zhEntry.l || '';
            result.rank = zhEntry.r || 0;
            result.pos = zhEntry.p || '';

            // 用第一个英文翻译去在线 API 拿音频、音标、释义
            var firstEnTrans = (zhEntry.t && zhEntry.t.length > 0) ? zhEntry.t[0] : '';
            if (firstEnTrans) {
                try {
                    var enOnline = await fetchOnlineEnglish(firstEnTrans);
                    if (enOnline) {
                        if (enOnline.audioUrl) result.audioUrl = enOnline.audioUrl;
                        if (enOnline.phonetic) result.phonetic = enOnline.phonetic;
                        if (enOnline.definition) result.definition = enOnline.definition;
                        if (enOnline.example) result.example = enOnline.example;
                    }
                } catch (_zhOnlineErr) {}
            }
        }
    }

    return result;
}
