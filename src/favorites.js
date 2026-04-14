/**
 * 收藏单词管理
 */

var _moduleName = '';

export function initFavorites(moduleName) {
    _moduleName = moduleName;
}

function ctx() {
    return SillyTavern.getContext();
}

function getList() {
    var es = ctx().extensionSettings;
    if (!es[_moduleName]) return [];
    if (!Array.isArray(es[_moduleName].favorites)) {
        es[_moduleName].favorites = [];
    }
    return es[_moduleName].favorites;
}

function save() {
    try {
        ctx().saveSettingsDebounced();
    } catch (_) {}
}

export function addFavorite(entry, lang, extraInfo) {
    var list = getList();
    var key = String(entry.w || '').toLowerCase() + ':' + String(lang || 'en');

    for (var i = 0; i < list.length; i++) {
        if (list[i].key === key) return false;
    }

    var item = {
        key: key,
        word: String(entry.w || ''),
        lang: String(lang || 'en'),
        level: String(entry.l || ''),
        pos: String(entry.p || ''),
        rank: Number(entry.r || 0),
        translations: Array.isArray(entry.t) ? entry.t.slice() : [],
        aliases: Array.isArray(entry.a) ? entry.a.slice() : [],
        addedAt: Date.now(),
    };

    if (extraInfo) {
        if (extraInfo.phonetic) item.phonetic = String(extraInfo.phonetic);
        if (extraInfo.definition) item.definition = String(extraInfo.definition);
        if (extraInfo.example) item.example = String(extraInfo.example);
        if (extraInfo.audioUrl) item.audioUrl = String(extraInfo.audioUrl);
    }

    list.push(item);
    save();
    document.dispatchEvent(new CustomEvent('learnlock:favorites-updated'));
    return true;
}

export function removeFavorite(key) {
    var list = getList();
    for (var i = 0; i < list.length; i++) {
        if (list[i].key === key) {
            list.splice(i, 1);
            save();
            document.dispatchEvent(new CustomEvent('learnlock:favorites-updated'));
            return true;
        }
    }
    return false;
}

export function removeFavorites(keys) {
    var list = getList();
    var keySet = {};
    for (var k = 0; k < keys.length; k++) keySet[keys[k]] = true;
    var before = list.length;
    for (var i = list.length - 1; i >= 0; i--) {
        if (keySet[list[i].key]) list.splice(i, 1);
    }
    if (list.length !== before) {
        save();
        document.dispatchEvent(new CustomEvent('learnlock:favorites-updated'));
    }
}

export function isFavorite(word, lang) {
    var list = getList();
    var key = String(word || '').toLowerCase() + ':' + String(lang || 'en');
    for (var i = 0; i < list.length; i++) {
        if (list[i].key === key) return true;
    }
    return false;
}

export function getFavorites() {
    return getList().slice();
}
