// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu (derived from robertn_waze_cluster)
/**
 * mgux_hud_map - moves the CarPlay map between the instrument cluster and the
 * head-up display. It is independent of every other app: it only talks to the
 * installed waze-on-cluster tool over its control socket (hud_control.js).
 *
 * One LT_State_Wide page: a status line and a Show map on button, which
 * switches between Cluster and HUD at once. The socket is held while the page
 * is visible and closed when it is hidden or the app shuts down.
 */
'use strict';

const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const { HudControl } = require('./hud_control.js');

const logger = logging.getSDKLogger();

const STATE_NAME = 'ST_OnlineApps_HudMap';
const STATUS_NAME = 'wocStatus';
const DISPLAY_NAME = 'wocDisplay';
const BIGGER = 'wocHudSize', SMALLER = 'wocHudSmaller', WIDER = 'wocHudWider', NARROWER = 'wocHudNarrower';
const TALLER = 'wocHudTaller', SHORTER = 'wocHudShorter', LEFT = 'wocHudLeft', RIGHT = 'wocHudRight';
const BAR_SIZE = 'wocBarSize', BAR_H = 'wocBarH', BAR_V = 'wocBarV', BAR_B = 'wocBarBright';
const BRIGHTER = 'wocBrightUp', DARKER = 'wocBrightDown';
const BAR_Z = 'wocBarZoom', BAR_R = 'wocBarRot';
const EDGES = [['wocEdgeLeftOut', 'left', 1], ['wocEdgeLeftIn', 'left', -1], ['wocEdgeRightOut', 'right', 1], ['wocEdgeRightIn', 'right', -1],
    ['wocEdgeTopOut', 'top', 1], ['wocEdgeTopIn', 'top', -1], ['wocEdgeBottomOut', 'bottom', 1], ['wocEdgeBottomIn', 'bottom', -1]];
const ZOOM_IN = 'wocZoomIn', ZOOM_OUT = 'wocZoomOut', ROT_L = 'wocRotL', ROT_R = 'wocRotR';
const WHICH = 'wocWhich';
const UP = 'wocHudUp', DOWN = 'wocHudDown', CENTRE = 'wocHudCentre', STEP = 'wocStep', RESET = 'wocReset';
const ADJUST_NAMES = EDGES.map((e) => e[0]).concat([ZOOM_IN, ZOOM_OUT, ROT_L, ROT_R, BRIGHTER, DARKER, BIGGER, SMALLER, WIDER, NARROWER, TALLER, SHORTER, LEFT, RIGHT, UP, DOWN, CENTRE, RESET]);
const PRESS_DEDUPE_MS = 400;

/* RHMI event values arrive as booleans, or as 1/0 on some HMIs. */
function isTrue(raw) {
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

class HudMapApp extends OnlineApp {
    constructor() {
        super();
        this._state = null;
        this._components = {};
        this._actionById = {};
        this._lastPress = {};
        this._written = {};
        this._visible = false;
        this._sawForeground = false;
        this._shutdownPromise = null;
        this._control = new HudControl({ log: logger });
        this._control.on('change', () => this._render());

        this.on('initialized', () => {
            this._appInitialized()
                .catch((err) => logger.error(`mgux_hud_map init failed: ${err && err.message}`));
        });
        this.on('shutdown', (reason) => this._handleShutdown(reason));
        this.on('error', (err) => logger.warn(`OnlineApp error: ${err && err.message}`));
        this.on('entryPointExecute', (uuid) => this._onEntryPointExecute(uuid));
        this.on('changeVisibility', (data) => {
            if (data && data.visible === false) {
                this._setVisible(false);
            }
        });
    }

    _appInitialized() {
        logger.info(`mgux_hud_map ${this.getAppId()} v${this._packageJson.version} starting`);
        if (!this.rhmiApplication) {
            logger.info('no RhmiApplication for this start reason; initializing without a screen');
            return this.initialized();
        }
        const foregroundStart = this._startedForeground();
        return this._setupRhmi()
            .then(() => this._registerEntryPoints())
            .then(() => {
                // A foreground start declares itself ACTIVE before initialized()
                // reports the first app status, so the manager keeps it running.
                if (foregroundStart) {
                    this.registerActive();
                }
                return this.initialized();
            })
            .then(() => {
                if (foregroundStart) {
                    this._sawForeground = true;
                    this._setVisible(true);
                }
                const lastUuid = this.getLastExecutedEntryPointUuid &&
                    this.getLastExecutedEntryPointUuid();
                return lastUuid ? this._onEntryPointExecute(lastUuid) : undefined;
            });
    }

    _startedForeground() {
        const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK',
            'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];
        const data = this.getVisibilityData && this.getVisibilityData();
        const reason = (data && data.reason) || this.startReason;
        return FOREGROUND_REASONS.includes(reason);
    }

    /* ---- RHMI ---- */
    _setupRhmi() {
        const rhmi = this.rhmiApplication;
        this._state = rhmi.getByName(STATE_NAME);
        if (!this._state) {
            return Promise.reject(new Error(`uiDescription has no ${STATE_NAME}`));
        }
        const names = [STATUS_NAME, DISPLAY_NAME, STEP, BAR_SIZE, BAR_H, BAR_V, BAR_B, BAR_Z, BAR_R, WHICH].concat(ADJUST_NAMES);
        names.forEach((name) => { this._components[name] = rhmi.getByName(name); });
        const missing = names.filter((name) => !this._components[name]);
        if (missing.length) {
            return Promise.reject(new Error(`uiDescription lacks ${missing.join(', ')}`));
        }
        const c = this._control;
        this._bind(DISPLAY_NAME, () => c.toggle());
        this._bind(BIGGER, () => c.resize(1));
        this._bind(SMALLER, () => c.resize(-1));
        this._bind(WIDER, () => c.stretch('w', 1));
        this._bind(NARROWER, () => c.stretch('w', -1));
        this._bind(TALLER, () => c.stretch('h', 1));
        this._bind(SHORTER, () => c.stretch('h', -1));
        this._bind(LEFT, () => c.move('left'));
        this._bind(RIGHT, () => c.move('right'));
        this._bind(UP, () => c.move('up'));
        this._bind(DOWN, () => c.move('down'));
        this._bind(CENTRE, () => c.centre());
        this._bind(STEP, () => c.cycleStep());
        this._bind(RESET, () => c.reset());
        this._bind(WHICH, () => c.cycleWhich());
        EDGES.forEach(([name, edge, dir]) => this._bind(name, () => c.edge(edge, dir)));
        this._bind(BRIGHTER, () => c.brightness(1));
        this._bind(ZOOM_IN, () => c.zoom(1));
        this._bind(ZOOM_OUT, () => c.zoom(-1));
        this._bind(ROT_L, () => c.rotate(-1));
        this._bind(ROT_R, () => c.rotate(1));
        this._bind(DARKER, () => c.brightness(-1));
        // Presses also arrive as the application's raw 'userEvent'; both paths
        // land in _press, which keeps a press delivered twice to one.
        rhmi.on('userEvent', (ev) => {
            const entry = ev && ev.eventType === 'ACTION' && this._actionById[Number(ev.sourceId)];
            if (entry) {
                this._press(entry.name, entry.handler);
            }
        });
        rhmi.on('applicationStackChanged', (stack) => {
            // The app holds the foreground while the stack has a ROOT_APP slot;
            // the empty stack seen during startup is ignored.
            const keys = stack && typeof stack === 'object' ? Object.keys(stack) : [];
            if (!keys.length) {
                return;
            }
            if (Object.prototype.hasOwnProperty.call(stack, 'ROOT_APP')) {
                this._sawForeground = true;
                this._setVisible(true);
            } else if (this._sawForeground) {
                this._setVisible(false);
            }
        });
        rhmi.on('restoreHmi', () => {
            logger.info('RESTORE_HMI: re-pushing page content');
            this._written = {};
            this._render();
        });
        this._state.on('visible', (event) => {
            const visible = isTrue(event && event.visible);
            if (visible) {
                this._sawForeground = true;
            }
            this._setVisible(visible);
        });
        return Promise.resolve(this._state.updateResources()).then(() => {
            logger.info(`page ready: ${names.length} components found`);
            this._render();
        });
    }

    _bind(name, handler) {
        const comp = this._components[name];
        let id = null;
        try {
            id = comp.getId();
        } catch (e) {
            id = null;
        }
        if (id !== null) {
            this._actionById[Number(id)] = { name, handler };
        }
        logger.info(`BIND OK: ${name} (id ${id})`);
        comp.on('action', () => this._press(name, handler));
    }

    _press(name, handler) {
        const now = Date.now();
        if (now - (this._lastPress[name] || 0) < PRESS_DEDUPE_MS) {
            return;
        }
        this._lastPress[name] = now;
        logger.info(`BUTTON ACTION ${name}`);
        try {
            handler();
        } catch (err) {
            logger.warn(`${name} failed: ${err && err.message}`);
        }
    }

    /* The app manager inserts the public tile from application.json and hands
     * it to the app at start; the SDK emits 'entryPointExecute' on a tap. */
    _registerEntryPoints() {
        const descriptions = (this.appDescription &&
            this.appDescription.application.entryPoints) || [];
        const ours = this.getEntryPoints().find(
            (ep) => descriptions.some((d) => d.uuid === ep.getDescription().uuid));
        if (!ours) {
            return Promise.reject(new Error('no entry point handed over by the manager'));
        }
        const description = ours.getDescription();
        return ours.init()
            .then(() => this.rhmiApplication.mapEntryState(description.uuid, this._state))
            .then(() => Promise.resolve()
                .then(() => ours.entryPoint.setText(description.textId))
                .then(() => (description.icon ? ours.entryPoint.setIcon(description.icon) : undefined))
                .catch((err) => logger.warn(`entry point text/icon: ${err && err.message}`)))
            .then(() => ours.setAvailability('ENABLED'))
            .then(() => logger.info(`entry point ${description.name} ENABLED`));
    }

    _onEntryPointExecute(uuid) {
        if (this._shutdownPromise || !this.rhmiApplication || !uuid) {
            return Promise.resolve();
        }
        this._sawForeground = true;
        this._setVisible(true);
        return Promise.resolve(this.rhmiApplication.openEntryState(uuid))
            .catch((err) => logger.warn(`openEntryState failed: ${err && err.message}`));
    }

    /* ---- visibility ---- */
    _setVisible(visible) {
        if (this._shutdownPromise || this._visible === visible) {
            return;
        }
        this._visible = visible;
        logger.info(`page ${visible ? 'visible' : 'hidden'}`);
        this._reportVisibilityStatus(visible);
        if (visible) {
            this._control.open();
        } else {
            this._control.close();
        }
    }

    _reportVisibilityStatus(visible) {
        if (!this._initialized || !this._appStatusService) {
            return;
        }
        const reports = visible ?
            [this.registerActive(), this.registerHmiVisible()] :
            [this.unregisterHmiVisible(), this.registerInactive()];
        reports.forEach((report) => Promise.resolve(report).catch((err) =>
            logger.warn(`app status report failed: ${err && err.message}`)));
    }

    /* ---- rendering ---- */
    /* Writes text into a component's row unless it already shows it. */
    _write(name, text) {
        if (this._written[name] !== text) {
            this._written[name] = text;
            Promise.resolve(this._components[name].setValue(0, 'Text', text, 'Text'))
                .catch((err) => logger.warn(`${name} render failed: ${err && err.message}`));
        }
    }

    /* Enables a button unless it already holds that state. */
    _setEnabled(name, enabled) {
        const key = `enabled:${name}`;
        if (this._written[key] !== enabled) {
            this._written[key] = enabled;
            Promise.resolve(this._components[name].setEnabled(enabled))
                .catch((err) => logger.warn(`${name} enable failed: ${err && err.message}`));
        }
    }

    _render() {
        if (!this._state || this._shutdownPromise) {
            return;
        }
        this._write(STATUS_NAME, this._control.statusText());
        this._write(DISPLAY_NAME, this._control.displayText());
        this._setEnabled(DISPLAY_NAME, this._control.canSwitch());
        this._write(BAR_SIZE, this._control.sizeBar());
        this._write(BAR_H, this._control.horizontalBar());
        this._write(BAR_V, this._control.verticalBar());
        this._write(BAR_B, this._control.brightBar());
        this._write(BAR_Z, this._control.zoomBar());
        this._write(BAR_R, this._control.rotateBar());
        this._write(STEP, this._control.stepText());
        ADJUST_NAMES.forEach((n) => this._setEnabled(n, this._control.canAdjust()));
        this._setEnabled(STEP, true);
        this._write(WHICH, this._control.whichText());
        this._setEnabled(WHICH, this._control.canAdjust());
    }

    /* ---- shutdown ---- */
    _handleShutdown(reason) {
        if (this._shutdownPromise) {
            return this._shutdownPromise;
        }
        logger.info(`mgux_hud_map shutdown: ${JSON.stringify(reason)}`);
        this._control.close();
        this._shutdownPromise = Promise.resolve()
            .then(() => this.destroyBundles().catch((err) =>
                logger.info(`destroyBundles: ${err && err.message}`)))
            .then(() => process.exit(0));
        return this._shutdownPromise;
    }
}

const app = new HudMapApp();
app.start().catch((err) => {
    /* Stays resident so the manager can stop or restart it. */
    logger.error(`mgux_hud_map failed to start: ${err && err.message}`);
});
