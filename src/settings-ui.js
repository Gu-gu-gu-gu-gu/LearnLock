let currentPracticeKey = '';

function getContext() {
    return SillyTavern.getContext();
}

async function waitForSettingsContainer(timeoutMs) {
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
        var $left = $('#extensions_settings');
        if ($left.length > 0) return $left;
        var $right = $('#extensions_settings2');
        if ($right.length > 0) return $right;
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    throw new Error('未找到扩展设置容器');
}

async function loadSettingsHtml() {
    var candidates = [
        new URL('../settings.html', import.meta.url).href,
        '/scripts/extensions/third-party/LearnLock/settings.html'
    ];

    for (var i = 0; i < candidates.length; i += 1) {
        var url = candidates[i];
        try {
            var res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) continue;
            var html = await res.text();
            if (html && html.trim().length > 0) return html;
        } catch (e) {
            console.warn('[LearnLockMVP] settings.html 加载失败:', url, e);
        }
    }

    throw new Error('settings.html 加载失败');
}

export async function mountSettingsUI(args) {
    var moduleName = args.moduleName;
    var getSettings = args.getSettings;

    var context = getContext();
    var saveSettingsDebounced = context.saveSettingsDebounced;

    if ($('#learnlock-settings').length === 0) {
        var $container = await waitForSettingsContainer(10000);
        var html = await loadSettingsHtml();
        $container.append(html);
    }

    var settings = getSettings();
    $('#learnlock-enabled').prop('checked', settings.enabled);

    $('#learnlock-enabled').off('change.learnlock').on('change.learnlock', function (e) {
        var enabled = $(e.currentTarget).prop('checked');
        context.extensionSettings[moduleName].enabled = enabled;
        saveSettingsDebounced();
        document.dispatchEvent(new CustomEvent('learnlock:enabled-changed', {
            detail: { enabled: enabled }
        }));
    });

    // 面板入口按钮
    $(document).off('click.learnlock_open_panel', '#learnlock-open-panel');
    $(document).on('click.learnlock_open_panel', '#learnlock-open-panel', function () {
        document.dispatchEvent(new CustomEvent('learnlock:open-panel'));
    });

    console.log('[LearnLockMVP] 设置面板挂载完成（精简版）');
}
