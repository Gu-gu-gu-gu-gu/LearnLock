import { mountSettingsUI } from './src/settings-ui.js';
import { startMessageLocker } from './src/message-locker.js';
import { mountPanelButton } from './src/panel-ui.js';
import { initFavorites } from './src/favorites.js';
import { applyHighlightTheme } from './src/highlight-themes.js';

const MODULE_NAME = 'extension_learnlock_mvp';

const defaultSettings = Object.freeze({
    enabled: true,
    maxWrongAttemptsBeforeHint: 2,
    wrongBookMaxItems: 200,
    wrongBookOnlyDue: false,
    unlockParagraphsPerQuestion: 1,
    maxWordCardsPerMessage: 40,
    minQuestionsPerMessage: 0,
    difficultyLevel: 'intermediate',
    synonymMode: 'loose',
    wrongBookPriority: 30,
    challengeTypes: ['cn_to_en', 'en_to_cn'],
    ignoreRegexLines: '',
    highlightTheme: 'glass',
    wrongBook: [],
    favorites: [],
});

function getContext() {
    return SillyTavern.getContext();
}

function loadSettings() {
    const context = getContext();
    const extensionSettings = context.extensionSettings;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
        }
    }

    if (!Array.isArray(extensionSettings[MODULE_NAME].wrongBook)) {
        extensionSettings[MODULE_NAME].wrongBook = [];
    }

    if (!Array.isArray(extensionSettings[MODULE_NAME].challengeTypes)) {
        extensionSettings[MODULE_NAME].challengeTypes = ['cn_to_en', 'en_to_cn'];
    }

    if (!Array.isArray(extensionSettings[MODULE_NAME].favorites)) {
        extensionSettings[MODULE_NAME].favorites = [];
    }

    const unlock = Number(extensionSettings[MODULE_NAME].unlockParagraphsPerQuestion);
    extensionSettings[MODULE_NAME].unlockParagraphsPerQuestion = Number.isFinite(unlock)
        ? Math.max(1, Math.min(50, unlock))
        : defaultSettings.unlockParagraphsPerQuestion;

    return extensionSettings[MODULE_NAME];
}

function getSettings() {
    return loadSettings();
}

async function init() {
    try {
        const settings = loadSettings();
        applyHighlightTheme(settings.highlightTheme || 'glass');

        await mountSettingsUI({
            moduleName: MODULE_NAME,
            getSettings,
            defaultSettings,
        });

        startMessageLocker({
            moduleName: MODULE_NAME,
            getSettings,
        });

        mountPanelButton(MODULE_NAME, getSettings);

        initFavorites(MODULE_NAME);

        console.log('[LearnLock] 插件初始化完成（v0.4.1）');
    } catch (error) {
        console.error('[LearnLock] 初始化失败:', error);
        toastr.error('Learn Lock 初始化失败，请打开控制台查看报错');
    }
}

const context = getContext();
const eventSource = context.eventSource;
const eventTypes = context.eventTypes || context.event_types;

eventSource.on(eventTypes.APP_READY, init);
