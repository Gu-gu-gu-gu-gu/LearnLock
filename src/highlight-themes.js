/**
 * 高亮主题预设 (包含发光毛玻璃效果)
 */

export var HIGHLIGHT_THEMES = {
    frost_glow: {
        name: '霜边泛光 (柔边发光)',
        css: [
            '.learnlock-hl-word {',
            '    border-radius: 6px;',
            '    padding: 1px 6px;',
            '    /* 极度透明的偏白/灰底色，制造玻璃透感 */',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);',
            '    border: none;',
            '    /* 重点：去除生硬线条，用3层发光叠加制造柔化边缘 */',
            '    /* 层1: 细微的边缘核心；层2: 向外的柔和光晕；层3: 向内的微弱泛光 */',
            '    box-shadow: ',
            '        0 0 0 1px color-mix(in srgb, var(--SmartThemeBodyColor) 25%, transparent),',
            '        0 0 8px color-mix(in srgb, var(--SmartThemeBodyColor) 25%, transparent),',
            '        inset 0 0 6px color-mix(in srgb, var(--SmartThemeBodyColor) 15%, transparent);',
            '    transition: all 0.3s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);',
            '    box-shadow: ',
            '        0 0 0 1px color-mix(in srgb, var(--SmartThemeBodyColor) 40%, transparent),',
            '        0 0 12px color-mix(in srgb, var(--SmartThemeBodyColor) 40%, transparent),',
            '        inset 0 0 8px color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);',
            '}',
            '.learnlock-hl-active {',
            '    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 10%, transparent);',
            '    box-shadow: ',
            '        0 0 0 1px var(--SmartThemeQuoteColor),',
            '        0 0 12px color-mix(in srgb, var(--SmartThemeQuoteColor) 60%, transparent),',
            '        inset 0 0 8px color-mix(in srgb, var(--SmartThemeQuoteColor) 30%, transparent);',
            '}',
            '.learnlock-hl-solved {',
            '    opacity: 0.6;',
            '    box-shadow: ',
            '        0 0 0 1px color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent),',
            '        0 0 4px color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent);',
            '}'
        ].join('\n')
    },
    glass: {
        name: '玻璃光泽 (提亮版)',
        css: [
            '.learnlock-hl-word {',
            '    border-radius: 6px;',
            '    padding: 0 6px;',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 12%, transparent);',
            '    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 30%, transparent);',
            '    box-shadow: 0 1px 3px color-mix(in srgb, #000 15%, transparent);',
            '    transition: all 0.2s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);',
            '    border-color: color-mix(in srgb, var(--SmartThemeBodyColor) 45%, transparent);',
            '}',
            '.learnlock-hl-active {',
            '    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 18%, transparent);',
            '    border-color: color-mix(in srgb, var(--SmartThemeQuoteColor) 50%, transparent);',
            '    box-shadow: 0 1px 4px color-mix(in srgb, var(--SmartThemeQuoteColor) 30%, transparent);',
            '}',
            '.learnlock-hl-solved {',
            '    opacity: 0.7;',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 6%, transparent);',
            '    border-color: color-mix(in srgb, var(--SmartThemeBodyColor) 15%, transparent);',
            '}'
        ].join('\n')
    },
    soft: {
        name: '柔和底色',
        css: [
            '.learnlock-hl-word {',
            '    border-radius: 4px;',
            '    padding: 0 4px;',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent);',
            '    transition: background 0.2s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 18%, transparent);',
            '}',
            '.learnlock-hl-active {',
            '    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent);',
            '}',
            '.learnlock-hl-solved {',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 5%, transparent);',
            '}'
        ].join('\n')
    },
    marker: {
        name: '马克笔',
        css: [
            '.learnlock-hl-word {',
            '    padding: 0 4px;',
            '    background: linear-gradient(120deg, color-mix(in srgb, var(--SmartThemeQuoteColor) 30%, transparent) 0%, color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent) 100%);',
            '    background-repeat: no-repeat;',
            '    background-size: 100% 35%;',
            '    background-position: 0 88%;',
            '    border-radius: 2px;',
            '    transition: background-size 0.2s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    background-size: 100% 80%;',
            '}',
            '.learnlock-hl-active {',
            '    background: linear-gradient(120deg, color-mix(in srgb, var(--SmartThemeQuoteColor) 50%, transparent) 0%, color-mix(in srgb, var(--SmartThemeQuoteColor) 40%, transparent) 100%);',
            '    background-repeat: no-repeat;',
            '    background-size: 100% 50%;',
            '    background-position: 0 88%;',
            '}',
            '.learnlock-hl-active:hover {',
            '    background-size: 100% 85%;',
            '}',
            '.learnlock-hl-solved {',
            '    background: linear-gradient(120deg, color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent) 0%, color-mix(in srgb, var(--SmartThemeBodyColor) 15%, transparent) 100%);',
            '    background-repeat: no-repeat;',
            '    background-size: 100% 30%;',
            '    background-position: 0 88%;',
            '}'
        ].join('\n')
    },
    dashbox: {
        name: '虚线外框',
        css: [
            '.learnlock-hl-word {',
            '    border-radius: 4px;',
            '    padding: 0 4px;',
            '    border: 1px dashed color-mix(in srgb, var(--SmartThemeBodyColor) 40%, transparent);',
            '    transition: all 0.2s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent);',
            '}',
            '.learnlock-hl-active {',
            '    border-color: var(--SmartThemeQuoteColor);',
            '    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 15%, transparent);',
            '}',
            '.learnlock-hl-solved {',
            '    border-color: color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);',
            '    opacity: 0.8;',
            '}'
        ].join('\n')
    },
    underline: {
        name: '简约下划',
        css: [
            '.learnlock-hl-word {',
            '    padding: 0 2px;',
            '    border-bottom: 2px solid color-mix(in srgb, var(--SmartThemeBodyColor) 25%, transparent);',
            '    transition: border-color 0.2s ease, background 0.2s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    border-bottom-color: color-mix(in srgb, var(--SmartThemeBodyColor) 60%, transparent);',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);',
            '}',
            '.learnlock-hl-active {',
            '    border-bottom: 2px solid var(--SmartThemeQuoteColor);',
            '    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 8%, transparent);',
            '}',
            '.learnlock-hl-solved {',
            '    border-bottom: 2px dashed color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);',
            '    opacity: 0.8;',
            '}'
        ].join('\n')
    },
    pill: {
        name: '胶囊形',
        css: [
            '.learnlock-hl-word {',
            '    border-radius: 12px;',
            '    padding: 1px 8px;',
            '    font-size: 0.95em;',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 12%, transparent);',
            '    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);',
            '    transition: all 0.2s ease;',
            '}',
            '.learnlock-hl-word:hover {',
            '    background: color-mix(in srgb, var(--SmartThemeBodyColor) 20%, transparent);',
            '}',
            '.learnlock-hl-active {',
            '    background: color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent);',
            '    border-color: color-mix(in srgb, var(--SmartThemeQuoteColor) 40%, transparent);',
            '}',
            '.learnlock-hl-solved {',
            '    background: transparent;',
            '    border-color: color-mix(in srgb, var(--SmartThemeBodyColor) 15%, transparent);',
            '    opacity: 0.8;',
            '}'
        ].join('\n')
    }
};

export var DEFAULT_THEME = 'frost_glow';

var STYLE_ELEMENT_ID = 'learnlock-highlight-theme-css';

export function applyHighlightTheme(themeKey) {
    var theme = HIGHLIGHT_THEMES[themeKey] || HIGHLIGHT_THEMES[DEFAULT_THEME];
    var el = document.getElementById(STYLE_ELEMENT_ID);
    if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ELEMENT_ID;
        document.head.appendChild(el);
    }
    el.textContent = theme.css;
}

export function getThemeList() {
    var list = [];
    for (var key in HIGHLIGHT_THEMES) {
        if (HIGHLIGHT_THEMES.hasOwnProperty(key)) {
            list.push({ key: key, name: HIGHLIGHT_THEMES[key].name });
        }
    }
    return list;
}
