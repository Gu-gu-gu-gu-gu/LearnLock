import { getFavorites, removeFavorite, removeFavorites } from './favorites.js';
import {
    ICON_COPY, ICON_TRASH, ICON_SELECT, ICON_UNCHECK,
    ICON_SELECTALL, ICON_AUDIO, ICON_FAV_FILLED
} from './icons.js';
import { lookup as dictLookup } from './dict-lookup.js';
import { lookupEnWord, lookupZhWord } from './difficulty.js';
import { buildWordCardHtml } from './text-highlighter.js';
import { applyHighlightTheme, getThemeList } from './highlight-themes.js';

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

var _moduleName = '';
var _getSettings = null;
var _selectMode = false;
var _selectedKeys = {};
var _currentTab = 'wrongbook';

export function mountPanelButton(moduleName, getSettings) {
    _moduleName = moduleName;
    _getSettings = getSettings;

    var attempts = 0;
    var timer = setInterval(function () {
        attempts++;
        if (attempts > 60) { clearInterval(timer); return; }
        if ($('#learnlock-panel-entry').length > 0) { clearInterval(timer); return; }

        var $menu = $('#extensionsMenu');
        if ($menu.length === 0) return;

        var $target = null;
        $menu.find('span').each(function () {
            if ($(this).text().trim() === '翻译输入') {
                $target = $(this).closest('div, a, button');
                return false;
            }
        });

        var $btn = $(
            '<div id="learnlock-panel-entry" class="interactable" tabindex="0" title="学习面板">' +
            '  <i class="fa-solid fa-graduation-cap"></i>' +
            '  <span>学习面板</span>' +
            '</div>'
        );

        if ($target && $target.length > 0) {
            var siblingClass = $target.attr('class') || '';
            if (siblingClass) {
                $btn.attr('class', siblingClass);
                $btn.attr('id', 'learnlock-panel-entry');
            }
            $target.after($btn);
        } else {
            $menu.append($btn);
        }

        clearInterval(timer);
        $btn.on('click', function () { openPanel(); });
    }, 500);

    document.addEventListener('learnlock:open-panel', function () { openPanel(); });

    $(document).off('click.ll_panel_overlay', '#learnlock-panel-overlay');
    $(document).on('click.ll_panel_overlay', '#learnlock-panel-overlay', function (e) {
        if ($(e.target).is('#learnlock-panel-overlay')) closePanel();
    });
    $(document).off('click.ll_panel_close', '#learnlock-panel-close');
    $(document).on('click.ll_panel_close', '#learnlock-panel-close', function () { closePanel(); });
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDue(dueAt) {
    var d = Number(dueAt || 0) - Date.now();
    if (d <= 0) return '已到期';
    var m = Math.ceil(d / 60000);
    if (m < 60) return m + ' 分钟后';
    var h = Math.ceil(m / 60);
    if (h < 24) return h + ' 小时后';
    return Math.ceil(h / 24) + ' 天后';
}

function hasCjk(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function deriveWrongBookCardMeta(item) {
    var meta = { word: '', lang: 'en' };
    var type = String(item && item.type || '');
    var question = String(item && item.question || '');
    var answer = String(item && item.answer || '');

    if (type === 'en_to_cn') {
        var enMatch = question.match(/[：:]\s*(.+)$/);
        meta.word = enMatch ? enMatch[1].trim() : answer;
        meta.lang = 'en';
    } else if (type === 'cn_to_en') {
        meta.word = answer || '';
        meta.lang = 'en';
        if (!meta.word) {
            var zhMatch = question.match(/[：:]\s*(.+)$/);
            if (zhMatch && zhMatch[1]) meta.word = zhMatch[1].trim();
        }
    } else {
        meta.word = answer || question;
        meta.lang = hasCjk(meta.word) ? 'zh' : 'en';
    }

    if (!meta.word) {
        var fallback = question.match(/[：:]\s*(.+)$/);
        if (fallback && fallback[1]) meta.word = fallback[1].trim();
    }
    if (!meta.word) meta.word = answer || question;
    if (!meta.lang) meta.lang = hasCjk(meta.word) ? 'zh' : 'en';

    meta.word = String(meta.word || '');
    return meta;
}

function ctx() { return SillyTavern.getContext(); }

function saveSettings() {
    try { ctx().saveSettingsDebounced(); } catch (_) {}
}

/* ========== 错题本 ========== */

function buildWrongBookTab(settings) {
    var wb = Array.isArray(settings.wrongBook) ? settings.wrongBook : [];
    var now = Date.now();
    var dueCount = wb.filter(function (x) { return Number(x.dueAt || 0) <= now; }).length;
    var sorted = wb.slice().sort(function (a, b) { return Number(a.dueAt || 0) - Number(b.dueAt || 0); });

    var h = '';

    h += '<div class="ll-tab-stats">';
    h += '  <span>📋 共 <b>' + wb.length + '</b> 题</span>';
    h += '  <span>⏰ 待复习 <b>' + dueCount + '</b></span>';
    h += '</div>';

    h += '<div class="ll-wb-toolbar">';
    h += '  <input id="llp-search" class="text_pole ll-search-input" type="text" placeholder="搜索错题...">';
    h += '  <button id="llp-select-toggle" class="menu_button ll-icon-btn" title="选择模式">' + ICON_SELECT + '</button>';
    h += '</div>';

    h += '<div class="ll-inline-hint">点击错题正文即可展开对应的词卡</div>';

    h += '<div id="llp-select-actions" class="ll-select-actions" style="display:none;">';
    h += '  <button id="llp-select-all" class="menu_button ll-icon-btn" title="全选">' + ICON_SELECTALL + ' 全选</button>';
    h += '  <button id="llp-delete-selected" class="menu_button ll-icon-btn ll-btn-danger" title="删除选中">' + ICON_TRASH + ' 删除</button>';
    h += '  <span id="llp-select-count" class="ll-select-count">已选 0</span>';
    h += '</div>';

    h += '<div id="llp-wb-list" class="ll-wb-list">';
    if (sorted.length === 0) {
        h += '<div class="ll-panel-empty">🎉 暂无错题</div>';
    } else {
        for (var j = 0; j < Math.min(200, sorted.length); j++) {
            var it = sorted[j];
            var due = Number(it.dueAt || 0) <= now;
            var key = String(it.key || '');
            var searchKey = (String(it.question || '') + ' ' + String(it.answer || '')).toLowerCase();
            var cardMeta = deriveWrongBookCardMeta(it);
            h += '<div class="ll-wb-item' + (due ? ' ll-wb-due' : '') + '"'
                + ' data-wb-key="' + esc(key) + '"'
                + ' data-sk="' + esc(searchKey) + '"'
                + ' data-wb-type="' + esc(String(it.type || '')) + '"'
                + ' data-wb-card-word="' + esc(cardMeta.word) + '"'
                + ' data-wb-card-lang="' + esc(cardMeta.lang) + '">';
            h += '<div class="ll-wb-item-row">';
            h += '<span class="ll-wb-checkbox" style="display:none;" data-wb-key="' + esc(key) + '">' + ICON_UNCHECK + '</span>';
            h += '<div class="ll-wb-item-content">';
            h += '<div><b>Q:</b> ' + esc(it.question) + '</div>';
            h += '<div><b>A:</b> ' + esc(it.answer) + '</div>';
            h += '<div class="ll-wb-meta">错 ' + Number(it.wrongCount || 0) + ' 次 · 连对 ' + Number(it.sm2Repetitions || 0) + ' · 间隔 ' + Number(it.sm2IntervalDays || 0) + ' 天 · Ease ' + Number(it.sm2Ease || 2.5).toFixed(1) + ' · ' + esc(formatDue(it.dueAt)) + '</div>';
            h += '</div></div></div>';
        }
    }
    h += '</div>';

    return h;
}

/* ========== 收藏 ========== */

function buildFavoritesTab() {
    var favs = getFavorites();
    var h = '';

    h += '<div class="ll-tab-stats">';
    h += '  <span>⭐ 共 <b>' + favs.length + '</b> 个收藏</span>';
    h += '</div>';

    h += '<div id="llp-fav-list" class="ll-fav-list">';
    if (favs.length === 0) {
        h += '<div class="ll-panel-empty">暂无收藏，点击正文中高亮单词卡片上的 ☆ 即可收藏</div>';
    } else {
        for (var i = 0; i < favs.length; i++) {
            var fav = favs[i];
            var trans = Array.isArray(fav.translations) ? fav.translations.join('，') : '';
            h += '<div class="ll-fav-item" data-fav-key="' + esc(fav.key) + '">';
            h += '<div class="ll-fav-header">';
            h += '  <span class="ll-fav-word">' + esc(fav.word) + '</span>';
            if (fav.level) h += ' <span class="learnlock-wc-level">' + esc(fav.level) + '</span>';
            if (fav.pos) h += ' <span class="learnlock-wc-pos">' + esc(fav.pos) + '</span>';
            if (fav.phonetic) h += ' <span class="learnlock-wc-phonetic">' + esc(fav.phonetic) + '</span>';
            var favAudioWord = fav.word;
            if (fav.lang === 'zh' && Array.isArray(fav.translations) && fav.translations.length > 0) {
                favAudioWord = fav.translations[0];
            }
            h += ' <button class="learnlock-wc-audio-btn ll-fav-audio"'
                + ' data-audio-url="' + esc(fav.audioUrl || '') + '"'
                + ' data-tts-word="' + esc(favAudioWord) + '"'
                + ' data-tts-lang="en"'
                + ' title="播放发音">' + ICON_AUDIO + '</button>';
            h += '  <button class="ll-fav-remove menu_button ll-icon-btn" data-fav-key="' + esc(fav.key) + '" title="取消收藏">' + ICON_TRASH + '</button>';
            h += '</div>';
            if (trans) h += '<div class="ll-fav-trans">' + esc(trans) + '</div>';
            if (fav.definition) h += '<div class="ll-fav-row"><b>释义：</b>' + esc(fav.definition) + '</div>';
            if (fav.example) h += '<div class="ll-fav-row"><b>例句：</b><i>' + esc(fav.example) + '</i></div>';
            h += '</div>';
        }
    }
    h += '</div>';

    return h;
}

/* ========== 设置 ========== */

function buildSettingsTab(settings) {
    var h = '';

    h += '<details class="ll-panel-section" open>';
    h += '<summary><b>🎨 外观设置</b></summary>';
    h += '<div class="ll-panel-section-body">';

    h += '<div class="ll-row"><label>高亮主题</label>';
    h += '<select id="llp-hl-theme" class="text_pole">';
    var themes = getThemeList();
    for (var ti = 0; ti < themes.length; ti++) {
        var sel = settings.highlightTheme === themes[ti].key ? ' selected' : '';
        h += '<option value="' + themes[ti].key + '"' + sel + '>' + esc(themes[ti].name) + '</option>';
    }
    h += '</select></div>';

    h += '<div class="ll-row-full">';
    h += '<label>主题预览</label>';
    h += '<div id="llp-theme-preview" class="ll-theme-preview">';
    h += '  <span class="learnlock-hl-word">highlight</span> ';
    h += '  <span class="learnlock-hl-word learnlock-hl-active">active</span> ';
    h += '  <span class="learnlock-hl-word learnlock-hl-solved">solved</span>';
    h += '</div>';
    h += '</div>';

    h += '</div></details>';

    h += '<details class="ll-panel-section" open>';
    h += '<summary><b>⚙️ 题目设置</b></summary>';
    h += '<div class="ll-panel-section-body">';

    h += '<div class="ll-row"><label>词汇难度</label>';
    h += '<select id="llp-difficulty" class="text_pole">';
    var levels = [['beginner','入门 A1'],['elementary','基础 A1~A2'],['intermediate','中级 A1~B1'],['upper','中高级 A2~B2'],['advanced','高级 B1~C1'],['challenge','挑战 B2~C1']];
    for (var li = 0; li < levels.length; li++) {
        var sel = settings.difficultyLevel === levels[li][0] ? ' selected' : '';
        h += '<option value="' + levels[li][0] + '"' + sel + '>' + levels[li][1] + '</option>';
    }
    h += '</select></div>';

    h += '<div class="ll-row"><label>判题模式</label>';
    h += '<select id="llp-synonym" class="text_pole">';
    h += '<option value="loose"' + (settings.synonymMode === 'loose' ? ' selected' : '') + '>宽松（同义词判对）</option>';
    h += '<option value="strict"' + (settings.synonymMode === 'strict' ? ' selected' : '') + '>严格（只认标准答案）</option>';
    h += '</select></div>';

    h += '<div class="ll-row"><label>启用题型</label><div class="ll-checks">';
    var types = settings.challengeTypes || ['cn_to_en','en_to_cn'];
    h += '<label><input type="checkbox" id="llp-cn2en"' + (types.indexOf('cn_to_en') >= 0 ? ' checked' : '') + '> 中译英</label>';
    h += '<label><input type="checkbox" id="llp-en2cn"' + (types.indexOf('en_to_cn') >= 0 ? ' checked' : '') + '> 英译中</label>';
    h += '</div></div>';

    h += '<div class="ll-row"><label>错题优先概率 %</label>';
    h += '<input id="llp-wb-priority" class="text_pole" type="number" min="0" max="100" step="5" value="' + Number(settings.wrongBookPriority || 30) + '"></div>';

    h += '<div class="ll-row"><label>每题解锁段数</label>';
    h += '<input id="llp-unlock" class="text_pole" type="number" min="1" max="50" value="' + Number(settings.unlockParagraphsPerQuestion || 1) + '"></div>';

    h += '<div class="ll-row"><label>每条消息词卡上限</label>';
    h += '<input id="llp-max-hl" class="text_pole" type="number" min="0" max="300" value="' + Number(settings.maxWordCardsPerMessage || 0) + '">';
    h += '<span class="ll-inline-hint">0 表示不限制；词卡会随机分散在正文中</span></div>';

    h += '<div class="ll-row"><label>错误几次后提示</label>';
    h += '<input id="llp-max-wrong" class="text_pole" type="number" min="1" max="10" value="' + Number(settings.maxWrongAttemptsBeforeHint || 2) + '"></div>';

    h += '</div></details>';

    h += '<details class="ll-panel-section">';
    h += '<summary><b>🔧 高级设置</b></summary>';
    h += '<div class="ll-panel-section-body">';
    h += '<div class="ll-row"><label>错题本上限</label>';
    h += '<input id="llp-wb-max" class="text_pole" type="number" min="20" max="2000" step="10" value="' + Number(settings.wrongBookMaxItems || 200) + '"></div>';

    h += '<div class="ll-row"><label><input type="checkbox" id="llp-only-due"' + (settings.wrongBookOnlyDue ? ' checked' : '') + '> 只显示已到期错题</label></div>';

    h += '<div class="ll-row-full"><label>忽略正则（每行一条）</label>';
    h += '<textarea id="llp-ignore-regex" class="text_pole" rows="3" placeholder="每行一个正则表达式">' + esc(settings.ignoreRegexLines || '') + '</textarea></div>';

    h += '</div></details>';

    h += '<details class="ll-panel-section">';
    h += '<summary><b>🔍 故障诊断</b></summary>';
    h += '<div class="ll-panel-section-body">';
    h += '<div id="llp-debug-status" class="learnlock-hint">日志持续记录中</div>';
    h += '<div class="ll-row" style="gap:6px;flex-wrap:wrap;">';
    h += '<button id="llp-dbg-copy" class="menu_button ll-icon-btn">' + ICON_COPY + ' 复制报告</button>';
    h += '<button id="llp-dbg-clear" class="menu_button ll-icon-btn">' + ICON_TRASH + ' 清空日志</button>';
    h += '</div>';
    h += '<textarea id="llp-dbg-output" class="text_pole" rows="6" style="width:100%;margin-top:8px;font-family:monospace;font-size:0.82em;" readonly></textarea>';
    h += '</div></details>';

    return h;
}

/* ========== 主面板 ========== */

function openPanel() {
    closePanel();
    _selectMode = false;
    _selectedKeys = {};
    var settings = _getSettings();

    var h = '';
    h += '<div id="learnlock-panel-overlay">';
    h += '<div id="learnlock-panel">';

    h += '<div class="learnlock-panel-header">';
    h += '  <h3>📚 学习面板</h3>';
    h += '  <button id="learnlock-panel-close" class="menu_button" title="关闭">✕</button>';
    h += '</div>';

    h += '<div class="ll-tab-bar">';
    h += '  <button class="ll-tab-btn' + (_currentTab === 'wrongbook' ? ' ll-tab-active' : '') + '" data-ll-tab="wrongbook">📝 错题本</button>';
    h += '  <button class="ll-tab-btn' + (_currentTab === 'favorites' ? ' ll-tab-active' : '') + '" data-ll-tab="favorites">⭐ 收藏</button>';
    h += '  <button class="ll-tab-btn' + (_currentTab === 'settings' ? ' ll-tab-active' : '') + '" data-ll-tab="settings">⚙️ 设置</button>';
    h += '</div>';

    h += '<div class="learnlock-panel-body">';
    h += '<div class="ll-tab-content' + (_currentTab === 'wrongbook' ? ' ll-tab-visible' : '') + '" data-ll-tab="wrongbook">' + buildWrongBookTab(settings) + '</div>';
    h += '<div class="ll-tab-content' + (_currentTab === 'favorites' ? ' ll-tab-visible' : '') + '" data-ll-tab="favorites">' + buildFavoritesTab() + '</div>';
    h += '<div class="ll-tab-content' + (_currentTab === 'settings' ? ' ll-tab-visible' : '') + '" data-ll-tab="settings">' + buildSettingsTab(settings) + '</div>';
    h += '</div>';

    h += '</div></div>';
    $('body').append(h);
    applyPanelViewportFix();
    document.body.style.setProperty('overflow', 'hidden');
    bindAllPanelEvents();
    switchTab(_currentTab || 'wrongbook');
}

function closePanel() {
    $('#learnlock-panel-overlay').remove();
    document.body.style.removeProperty('overflow');
}

function applyPanelViewportFix() {
    var overlay = document.getElementById('learnlock-panel-overlay');
    var panel = document.getElementById('learnlock-panel');
    var body = panel ? panel.querySelector('.learnlock-panel-body') : null;

    if (overlay) {
        overlay.style.setProperty('position', 'fixed', 'important');
        overlay.style.setProperty('inset', '0', 'important');
        overlay.style.setProperty('width', '100vw', 'important');
        overlay.style.setProperty('height', '100dvh', 'important');
        overlay.style.setProperty('z-index', '999999', 'important');
        overlay.style.setProperty('display', 'flex', 'important');
        overlay.style.setProperty('align-items', 'center', 'important');
        overlay.style.setProperty('justify-content', 'center', 'important');
        overlay.style.setProperty('padding', '12px', 'important');
        overlay.style.setProperty('box-sizing', 'border-box', 'important');
        overlay.style.setProperty('overflow', 'hidden', 'important');
    }

    if (panel) {
        panel.style.setProperty('position', 'relative', 'important');
        panel.style.setProperty('width', 'min(760px, calc(100vw - 24px))', 'important');
        panel.style.setProperty('max-width', '760px', 'important');
        panel.style.setProperty('height', 'min(900px, calc(100dvh - 24px))', 'important');
        panel.style.setProperty('max-height', 'calc(100dvh - 24px)', 'important');
        panel.style.setProperty('display', 'flex', 'important');
        panel.style.setProperty('flex-direction', 'column', 'important');
        panel.style.setProperty('overflow', 'hidden', 'important');
        panel.style.setProperty('margin', '0', 'important');
    }

    if (body) {
        body.style.setProperty('flex', '1', 'important');
        body.style.setProperty('min-height', '0', 'important');
        body.style.setProperty('overflow-y', 'auto', 'important');
        body.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important');
    }
}

function switchTab(tabName) {
    _currentTab = tabName;

    var $panel = $('#learnlock-panel');
    $panel.find('.ll-tab-btn').removeClass('ll-tab-active');
    $panel.find('.ll-tab-btn[data-ll-tab="' + tabName + '"]').addClass('ll-tab-active');

    $panel.find('.ll-tab-content').each(function () {
        this.style.removeProperty('display');
        this.classList.remove('ll-tab-visible');
    });

    var target = $panel.find('.ll-tab-content[data-ll-tab="' + tabName + '"]').get(0);
    if (target) {
        target.classList.add('ll-tab-visible');
    }
}

function updateSelectCount() {
    var count = Object.keys(_selectedKeys).length;
    $('#llp-select-count').text('已选 ' + count);
}

function bindAllPanelEvents() {
    var es = ctx().extensionSettings;
    var s = es[_moduleName];

    $(document).off('click.ll_tab', '.ll-tab-btn');
    $(document).on('click.ll_tab', '.ll-tab-btn', function () {
        switchTab($(this).attr('data-ll-tab'));
    });

    $('#llp-search').off('input').on('input', function () {
        var kw = String($(this).val() || '').toLowerCase().trim();
        $('#llp-wb-list .ll-wb-item').each(function () {
            var sk = $(this).attr('data-sk') || '';
            $(this).toggle(!kw || sk.indexOf(kw) >= 0);
        });
    });

    $('#llp-select-toggle').off('click').on('click', function () {
        _selectMode = !_selectMode;
        _selectedKeys = {};
        if (_selectMode) {
            $('#llp-select-actions').show();
            $('.ll-wb-checkbox').show();
            $(this).addClass('ll-btn-active');
        } else {
            $('#llp-select-actions').hide();
            $('.ll-wb-checkbox').hide().html(ICON_UNCHECK);
            $(this).removeClass('ll-btn-active');
        }
        updateSelectCount();
    });

    $(document).off('click.ll_wb_check', '.ll-wb-checkbox');
    $(document).on('click.ll_wb_check', '.ll-wb-checkbox', function (e) {
        e.stopPropagation();
        var key = $(this).attr('data-wb-key');
        if (_selectedKeys[key]) {
            delete _selectedKeys[key];
            $(this).html(ICON_UNCHECK);
        } else {
            _selectedKeys[key] = true;
            $(this).html(ICON_SELECT);
        }
        updateSelectCount();
    });

    $('#llp-select-all').off('click').on('click', function () {
        var visible = $('#llp-wb-list .ll-wb-item:visible');
        var allSelected = true;
        visible.each(function () {
            var key = $(this).attr('data-wb-key');
            if (!_selectedKeys[key]) allSelected = false;
        });

        if (allSelected) {
            visible.each(function () {
                var key = $(this).attr('data-wb-key');
                delete _selectedKeys[key];
                $(this).find('.ll-wb-checkbox').html(ICON_UNCHECK);
            });
        } else {
            visible.each(function () {
                var key = $(this).attr('data-wb-key');
                _selectedKeys[key] = true;
                $(this).find('.ll-wb-checkbox').html(ICON_SELECT);
            });
        }
        updateSelectCount();
    });

    $('#llp-delete-selected').off('click').on('click', function () {
        var keys = Object.keys(_selectedKeys);
        if (keys.length === 0) { toastr.info('请先选择要删除的错题'); return; }
        var list = s.wrongBook || [];
        var keySet = {};
        for (var i = 0; i < keys.length; i++) keySet[keys[i]] = true;
        s.wrongBook = list.filter(function (item) { return !keySet[item.key]; });
        saveSettings();
        _selectedKeys = {};
        toastr.success('已删除 ' + keys.length + ' 条');
        openPanel();
    });

    $(document).off('click.ll_wb_card', '.ll-wb-item-content');
    $(document).on('click.ll_wb_card', '.ll-wb-item-content', function (e) {
        if (_selectMode) return;
        if ($(e.target).closest('.ll-wb-checkbox').length > 0) return;

        var $item = $(this).closest('.ll-wb-item');
        var cardKey = $item.attr('data-wb-key') || '';
        var word = $item.attr('data-wb-card-word') || '';
        var lang = $item.attr('data-wb-card-lang') || 'en';
        if (!word) return;

        var $existing = $('#llp-wb-list .learnlock-panel-card');
        if ($existing.length && $existing.attr('data-for-key') === cardKey) {
            $existing.remove();
            return;
        }
        $('#llp-wb-list .learnlock-panel-card').remove();

        var entry = (lang === 'en') ? lookupEnWord(word) : lookupZhWord(word);
        if (!entry) {
            entry = { w: word, l: '', p: '', r: 0, t: [], a: [] };
        }

        var $card = $('<div class="learnlock-word-card-wrap learnlock-panel-card" data-for-key="' + esc(cardKey) + '"></div>');
        $card.html(buildWordCardHtml(entry, lang, null));
        $item.after($card);

        dictLookup(word, lang).then(function (info) {
            if (!info || !info.found) return;
            if ($card.attr('data-for-key') !== cardKey) return;
            $card.html(buildWordCardHtml(entry, lang, info));
        }).catch(function () {});
    });

    $(document).off('click.ll_fav_rm', '.ll-fav-remove');
    $(document).on('click.ll_fav_rm', '.ll-fav-remove', function (e) {
        e.stopPropagation();
        var key = $(this).attr('data-fav-key');
        removeFavorite(key);
        $(this).closest('.ll-fav-item').remove();
        toastr.success('已取消收藏');
    });

    $(document).off('click.ll_fav_audio', '.ll-fav-audio');
    $(document).on('click.ll_fav_audio', '.ll-fav-audio', function (e) {
        e.stopPropagation();
        var apiUrl = $(this).attr('data-audio-url') || '';
        var ttsWord = $(this).attr('data-tts-word') || '';
        var ttsLang = $(this).attr('data-tts-lang') || 'en';
        playAudioChain(apiUrl, ttsWord, ttsLang);
    });

    $('#llp-hl-theme').off('change').on('change', function () {
        var themeKey = $(this).val();
        s.highlightTheme = themeKey;
        applyHighlightTheme(themeKey);
        saveSettings();
    });

    $('#llp-difficulty').off('change').on('change', function () {
        s.difficultyLevel = $(this).val(); saveSettings();
    });
    $('#llp-synonym').off('change').on('change', function () {
        s.synonymMode = $(this).val(); saveSettings();
    });
    function updateTypes() {
        var t = [];
        if ($('#llp-cn2en').prop('checked')) t.push('cn_to_en');
        if ($('#llp-en2cn').prop('checked')) t.push('en_to_cn');
        if (t.length === 0) t = ['cn_to_en', 'en_to_cn'];
        s.challengeTypes = t; saveSettings();
    }
    $('#llp-cn2en, #llp-en2cn').off('change').on('change', updateTypes);
    $('#llp-wb-priority').off('input').on('input', function () {
        s.wrongBookPriority = Math.max(0, Math.min(100, Number($(this).val()) || 30)); saveSettings();
    });
    $('#llp-unlock').off('input').on('input', function () {
        s.unlockParagraphsPerQuestion = Math.max(1, Math.min(50, Number($(this).val()) || 1)); saveSettings();
    });
    $('#llp-max-hl').off('input').on('input', function () {
        s.maxWordCardsPerMessage = Math.max(0, Math.min(300, Number($(this).val()) || 0));
        saveSettings();
    });
    $('#llp-max-wrong').off('input').on('input', function () {
        s.maxWrongAttemptsBeforeHint = Math.max(1, Math.min(10, Number($(this).val()) || 2)); saveSettings();
    });
    $('#llp-wb-max').off('input').on('input', function () {
        s.wrongBookMaxItems = Math.max(20, Math.min(2000, Number($(this).val()) || 200)); saveSettings();
    });
    $('#llp-only-due').off('change').on('change', function () {
        s.wrongBookOnlyDue = $(this).prop('checked'); saveSettings();
    });
    $('#llp-ignore-regex').off('input').on('input', function () {
        s.ignoreRegexLines = String($(this).val() || ''); saveSettings();
    });

    var api = window.learnlockDebugApi;
    function refreshDbg() {
        if (!api) { $('#llp-debug-status').text('调试API未就绪'); return; }
        $('#llp-debug-status').text('日志持续记录中');
        $('#llp-dbg-output').val(String(api.getText() || ''));
    }
    refreshDbg();
    $('#llp-dbg-copy').off('click').on('click', function () {
        if (!api) return;
        var text = api.getReportText ? api.getReportText() : api.getText();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(function () { toastr.success('诊断报告已复制'); });
        }
    });
    $('#llp-dbg-clear').off('click').on('click', function () {
        if (!api) return; api.clear(); refreshDbg();
        toastr.success('日志已清空');
    });
}