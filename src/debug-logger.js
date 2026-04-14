const debugState = {
    enabled: false,
    maxLines: 600,
    lines: [],
};

function safeJsonStringify(obj) {
    try {
        return JSON.stringify(obj);
    } catch (_e) {
        return '"[unserializable]"';
    }
}

export function describeElement(node) {
    if (!node) return '(null)';
    var tag = String(node.tagName || '').toLowerCase();
    var id = node.id ? '#' + String(node.id) : '';
    var cls = '';
    if (node.classList && node.classList.length > 0) {
        cls = '.' + Array.from(node.classList).slice(0, 3).join('.');
    }
    return tag + id + cls;
}

export function pushDebugLog(type, data) {
    if (!debugState.enabled) return;
    var line = {
        at: new Date().toISOString(),
        type: String(type || ''),
        data: data || {},
    };
    debugState.lines.push(line);
    if (debugState.lines.length > debugState.maxLines) {
        debugState.lines.shift();
    }
}

function clearDebugLogs() {
    debugState.lines = [];
}

function getDebugLogsText() {
    if (!debugState.lines.length) return '[LearnLockMVP Debug] 日志为空';
    var out = [];
    for (var i = 0; i < debugState.lines.length; i += 1) {
        var line = debugState.lines[i];
        out.push('[' + line.at + '] ' + line.type + ' ' + safeJsonStringify(line.data));
    }
    return out.join('\n');
}

function uninstallDebugTraceListeners() {
    if (!window.__learnlockDebugTraceListeners) return;
    var listeners = window.__learnlockDebugTraceListeners;
    if (listeners.keydown) window.removeEventListener('keydown', listeners.keydown, true);
    if (listeners.keypress) window.removeEventListener('keypress', listeners.keypress, true);
    if (listeners.keyup) window.removeEventListener('keyup', listeners.keyup, true);
    if (listeners.focusin) window.removeEventListener('focusin', listeners.focusin, true);
    window.__learnlockDebugTraceListeners = null;
}

function installDebugTraceListeners() {
    uninstallDebugTraceListeners();

    var onKeydown = function (e) {
        var isEnter = e && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter');
        if (!isEnter) return;
        pushDebugLog('trace-keydown-capture', {
            key: e.key,
            code: e.code,
            target: describeElement(e.target),
            active: describeElement(document.activeElement),
            defaultPrevented: !!e.defaultPrevented,
        });
    };

    var onKeypress = function (e) {
        var isEnter = e && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter');
        if (!isEnter) return;
        pushDebugLog('trace-keypress-capture', {
            key: e.key,
            code: e.code,
            target: describeElement(e.target),
            active: describeElement(document.activeElement),
            defaultPrevented: !!e.defaultPrevented,
        });
    };

    var onKeyup = function (e) {
        var isEnter = e && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter');
        if (!isEnter) return;
        pushDebugLog('trace-keyup-capture', {
            key: e.key,
            code: e.code,
            target: describeElement(e.target),
            active: describeElement(document.activeElement),
            defaultPrevented: !!e.defaultPrevented,
        });
    };

    var onFocusin = function (e) {
        pushDebugLog('trace-focusin-capture', {
            target: describeElement(e.target),
            active: describeElement(document.activeElement),
        });
    };

    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('keypress', onKeypress, true);
    window.addEventListener('keyup', onKeyup, true);
    window.addEventListener('focusin', onFocusin, true);

    window.__learnlockDebugTraceListeners = {
        keydown: onKeydown,
        keypress: onKeypress,
        keyup: onKeyup,
        focusin: onFocusin,
    };
}

function setDebugEnabled(enabled) {
    var next = !!enabled;
    if (next === debugState.enabled) return;
    if (next) {
        debugState.enabled = true;
        installDebugTraceListeners();
        pushDebugLog('debug-enabled', { enabled: true });
    } else {
        pushDebugLog('debug-enabled', { enabled: false });
        uninstallDebugTraceListeners();
        debugState.enabled = false;
    }
}

export function installDebugApi(moduleName, getSettings, getExtraSnapshot) {
    function getRuntimeBase() {
        var settings = {};
        try {
            settings = getSettings ? getSettings() : {};
        } catch (_e) {
            settings = {};
        }

        return {
            moduleName: moduleName,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: {
                width: window.innerWidth,
                height: window.innerHeight,
                dpr: window.devicePixelRatio || 1,
            },
            location: String(location.href || ''),
            settings: {
                enabled: !!settings.enabled,
                unlockParagraphsPerQuestion: Number(settings.unlockParagraphsPerQuestion || 0),
                maxWrongAttemptsBeforeHint: Number(settings.maxWrongAttemptsBeforeHint || 0),
                wrongBookMaxItems: Number(settings.wrongBookMaxItems || 0),
                wrongBookOnlyDue: !!settings.wrongBookOnlyDue,
            },
        };
    }

    function buildRuntimeSnapshot() {
        var base = getRuntimeBase();
        var extra = {};
        try {
            extra = getExtraSnapshot ? getExtraSnapshot() || {} : {};
        } catch (_e) {
            extra = {};
        }
        return Object.assign({}, base, extra);
    }

    function getDebugReportText() {
        var header = [];
        header.push('=== LearnLockMVP Diagnostic Report ===');
        header.push('generatedAt=' + new Date().toISOString());
        header.push('runtime=' + safeJsonStringify(buildRuntimeSnapshot()));
        header.push('--- eventLogs ---');
        return header.join('\n') + '\n' + getDebugLogsText();
    }

    window.learnlockDebugApi = {
        setEnabled: function (enabled) {
            setDebugEnabled(enabled);
        },
        isEnabled: function () {
            return !!debugState.enabled;
        },
        clear: function () {
            clearDebugLogs();
        },
        getText: function () {
            return getDebugLogsText();
        },
        getReportText: function () {
            return getDebugReportText();
        },
        addMark: function (label) {
            pushDebugLog('mark', { label: String(label || '') });
        },
    };

    setDebugEnabled(true);
    clearDebugLogs();
}
