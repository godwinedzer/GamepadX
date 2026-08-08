import 'react-native-gesture-handler';

/**
 * ZapGamepad — App.js
 * Ultra-low-latency UDP controller client for Xbox 360 / XInput.
 *
 * Key architecture decisions:
 *  ? Buttons use per-finger manual press tracking while both sticks are
 *    explicitly simultaneous, enabling controller-style multi-touch.
 *  • Joystick + button gestures run 100 % on the native UI thread (worklets).
 *  • A single 60 Hz JS interval drives network transmission & rapid-fire tick.
 *  • Haptic vibration fires on every button BEGIN and joystick BEGIN.
 *  • Layout is fully responsive — no hardcoded pixel offsets. Uses flex + %
 *    sizing derived from live screen dimensions.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Dimensions,
  StatusBar,
  ActivityIndicator,
} from 'react-native';

// AsyncStorage — gracefully absent in bare/web environments
let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (_e) {
  // not critical
}

import * as Haptics from 'expo-haptics';
import { GamepadNetwork, Buttons } from './src/GamepadNetwork';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
  TouchableWithoutFeedback as RNGHTouchable,
} from 'react-native-gesture-handler';

import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────
// RESPONSIVE DIMENSIONS
// In landscape the larger value is always width.
// ─────────────────────────────────────────────────────────────
const DIM = Dimensions.get('window');
const SCREEN_W = Math.max(DIM.width, DIM.height);
const SCREEN_H = Math.min(DIM.width, DIM.height);

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
const C = {
  bg:        '#050505',
  panel:     '#0d0d0d',
  border:    '#1a1a1a',
  accent:    '#39ff14',   // neon green
  blue:      '#00d2ff',
  danger:    '#ff3f3f',
  warning:   '#ffd400',
  purple:    '#9b59b6',
  text:      '#ffffff',
  textDim:   '#666666',
  textDark:  '#000000',
};

// Joystick travel radius (px)
const STICK_RADIUS = 48;

// ─────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [ip, setIp]           = useState('10.63.68.67');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mouseMode, setMouseMode] = useState(false);
  const [rapidFireOn, setRapidFireOn] = useState(false);

  const networkRef = useRef(null);

  // ── Shared input values (written from UI worklets, read by JS interval) ──
  const buttons          = useSharedValue(0);   // 16-bit XInput bitmask
  const lx               = useSharedValue(0);
  const ly               = useSharedValue(0);
  const rx               = useSharedValue(0);
  const ry               = useSharedValue(0);
  const lt               = useSharedValue(0);   // 0-255
  const rt               = useSharedValue(0);   // 0-255
  const flags            = useSharedValue(0);   // bit0 = mouse mode
  const rapidFireEnabled = useSharedValue(0);   // 0 = off, 1 = on
  const ltRapidActive    = useSharedValue(0);
  const rtRapidActive    = useSharedValue(0);

  // ── Joystick visual positions (native UI thread) ──
  const leftX  = useSharedValue(0);
  const leftY  = useSharedValue(0);
  const leftScale  = useSharedValue(1);
  const rightX = useSharedValue(0);
  const rightY = useSharedValue(0);
  const rightScale = useSharedValue(1);

  // ── Ambient animations ──
  const fadeAnim    = useSharedValue(0);
  const slideAnim   = useSharedValue(20);
  const logoOpacity = useSharedValue(1);
  const statusPulse = useSharedValue(1);

  // ─────────────────────────────────────────────────────────────
  // ANIMATED STYLES
  // ─────────────────────────────────────────────────────────────
  const loginStyle = useAnimatedStyle(() => ({
    opacity:   fadeAnim.value,
    transform: [{ translateY: slideAnim.value }],
  }));

  const padContainerStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
  }));

  const statusStyle = useAnimatedStyle(() => ({
    transform: [{ scale: statusPulse.value }],
  }));

  const leftStickStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leftX.value },
      { translateY: leftY.value },
      { scale: leftScale.value },
    ],
  }));

  const rightStickStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rightX.value },
      { translateY: rightY.value },
      { scale: rightScale.value },
    ],
  }));

  // ─────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fadeAnim.value  = withTiming(1, { duration: 700 });
    slideAnim.value = withSpring(0, { damping: 15, stiffness: 80 });

    logoOpacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 2000 }),
        withTiming(1,   { duration: 2000 }),
      ),
      -1,
      true,
    );

    statusPulse.value = withRepeat(
      withSequence(
        withTiming(1.2, { duration: 900 }),
        withTiming(1,   { duration: 900 }),
      ),
      -1,
      true,
    );

    if (AsyncStorage?.getItem) {
      AsyncStorage.getItem('last_ip')
        .then((val) => { 
          if (val) {
            setIp(val);
            // Auto connect instantly
            handleConnectTo(val);
          }
        })
        .catch(() => null);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 60 Hz SEND LOOP + RAPID FIRE TICK
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!connected) return;

    let lastLtToggle = 0;
    let lastRtToggle = 0;

    const interval = setInterval(() => {
      const now = Date.now();

      // Rapid fire tick — LT
      if (ltRapidActive.value) {
        if (now - lastLtToggle > 80) {
          lt.value = lt.value > 0 ? 0 : 255;
          lastLtToggle = now;
        }
      } else if (rapidFireEnabled.value === 1) {
        lt.value = 0;
      }

      // Rapid fire tick — RT
      if (rtRapidActive.value) {
        if (now - lastRtToggle > 80) {
          rt.value = rt.value > 0 ? 0 : 255;
          lastRtToggle = now;
        }
      } else if (rapidFireEnabled.value === 1) {
        rt.value = 0;
      }

      // Transmit current state every frame (heartbeat keeps server alive)
      networkRef.current?.send(
        buttons.value,
        lt.value,
        rt.value,
        Math.round(lx.value),
        Math.round(ly.value),
        Math.round(rx.value),
        Math.round(ry.value),
        flags.value,
      );
    }, 16); // ~60 Hz

    return () => {
      clearInterval(interval);
      networkRef.current?.close();
      networkRef.current = null;
    };
  }, [connected]);

  // ─────────────────────────────────────────────────────────────
  // HAPTIC HELPER (JS side — called via runOnJS from worklets)
  // ─────────────────────────────────────────────────────────────
  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  };

  const triggerMediumHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
  };

  const resetInputState = () => {
    buttons.value = 0;
    lx.value = 0;
    ly.value = 0;
    rx.value = 0;
    ry.value = 0;
    lt.value = 0;
    rt.value = 0;
    flags.value = 0;
    rapidFireEnabled.value = 0;
    ltRapidActive.value = 0;
    rtRapidActive.value = 0;
    setMouseMode(false);
    setRapidFireOn(false);
  };

  const setMouseModeEnabled = (enabled) => {
    flags.value = enabled ? (flags.value | 1) : (flags.value & ~1);
    setMouseMode(enabled);
  };

  const setRapidFireMode = (enabled) => {
    if (enabled) {
      ltRapidActive.value = lt.value > 0 ? 1 : 0;
      rtRapidActive.value = rt.value > 0 ? 1 : 0;
      lt.value = 0;
      rt.value = 0;
      rapidFireEnabled.value = 1;
      setRapidFireOn(true);
      return;
    }

    const ltHeld = ltRapidActive.value === 1 || lt.value > 0;
    const rtHeld = rtRapidActive.value === 1 || rt.value > 0;
    rapidFireEnabled.value = 0;
    ltRapidActive.value = 0;
    rtRapidActive.value = 0;
    lt.value = ltHeld ? 255 : 0;
    rt.value = rtHeld ? 255 : 0;
    setRapidFireOn(false);
  };

  const handleDisconnect = () => {
    networkRef.current?.send(0, 0, 0, 0, 0, 0, 0, 0);
    resetInputState();
    setConnected(false);
  };

  // ─────────────────────────────────────────────────────────────
  // BUTTON BIT TOGGLE WORKLET
  // ─────────────────────────────────────────────────────────────
  const toggleButton = (bit, pressed) => {
    'worklet';
    if (bit === Buttons.LT) {
      if (rapidFireEnabled.value === 1) {
        ltRapidActive.value = pressed ? 1 : 0;
      } else {
        ltRapidActive.value = 0;
        lt.value = pressed ? 255 : 0;
      }
    } else if (bit === Buttons.RT) {
      if (rapidFireEnabled.value === 1) {
        rtRapidActive.value = pressed ? 1 : 0;
      } else {
        rtRapidActive.value = 0;
        rt.value = pressed ? 255 : 0;
      }
    } else {
      if (pressed) {
        buttons.value = buttons.value | bit;
      } else {
        buttons.value = buttons.value & ~bit;
      }
    }
  };


  const setButtonPressed = (bit) => {
    'worklet';
    toggleButton(bit, true);
  };

  const setButtonReleased = (bit) => {
    'worklet';
    toggleButton(bit, false);
  };

  // ─────────────────────────────────────────────────────────────
  // JOYSTICK GESTURE FACTORY
  // Returns a Gesture.Pan() configured for one stick.
  // ─────────────────────────────────────────────────────────────
  const makeStickGesture = (isLeft) =>
    Gesture.Pan()
      .minDistance(0)
      .onBegin(() => {
        'worklet';
        const scaleVal = isLeft ? leftScale : rightScale;
        scaleVal.value = withSpring(1.15, { damping: 14, stiffness: 300 });
        runOnJS(triggerHaptic)();
      })
      .onUpdate((e) => {
        'worklet';
        let dx = e.translationX;
        let dy = e.translationY;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > STICK_RADIUS) {
          const inv = STICK_RADIUS / mag;
          dx *= inv;
          dy *= inv;
        }

        if (isLeft) {
          leftX.value = dx;
          leftY.value = dy;
          lx.value    = (dx / STICK_RADIUS) * 32767;
          ly.value    = -(dy / STICK_RADIUS) * 32767;
        } else {
          rightX.value = dx;
          rightY.value = dy;
          rx.value     = (dx / STICK_RADIUS) * 32767;
          ry.value     = -(dy / STICK_RADIUS) * 32767;
        }
      })
      .onFinalize(() => {
        'worklet';
        const scaleVal = isLeft ? leftScale : rightScale;
        scaleVal.value = withSpring(1, { damping: 16, stiffness: 450 });

        if (isLeft) {
          leftX.value = withSpring(0, { damping: 16, stiffness: 450 });
          leftY.value = withSpring(0, { damping: 16, stiffness: 450 });
          lx.value = 0;
          ly.value = 0;
        } else {
          rightX.value = withSpring(0, { damping: 16, stiffness: 450 });
          rightY.value = withSpring(0, { damping: 16, stiffness: 450 });
          rx.value = 0;
          ry.value = 0;
        }
      });

  // ─────────────────────────────────────────────────────────────
  // CONTROL BUTTON ? zero re-renders, true per-finger hold behavior
  // Press begins on finger-down and releases only when that same finger lifts.
  const ControlBtn = ({
    label,
    bit,
    style,
    color = '#1a1a1a',
    textStyle = {},
    isTrigger = false,
    simultaneousGestures = sharedSimultaneousGestures,
  }) => {
    const active = useSharedValue(1);
    const activePointerId = useSharedValue(-1);

    const btnAnimStyle = useAnimatedStyle(() => ({
  transform: [
    { scale: active.value },
  ],
  borderColor: active.value < 1 ? C.accent : '#2F2F2F',
}));

    const gesture = useMemo(() => {
      const manualGesture = Gesture.Manual()
        .shouldCancelWhenOutside(false)
        .onTouchesDown((event, manager) => {
          'worklet';
          if (activePointerId.value !== -1) {
            return;
          }

          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }

          activePointerId.value = touch.id;
          setButtonPressed(bit);
         active.value = 0.96;
          manager.activate();
          runOnJS(isTrigger ? triggerMediumHaptic : triggerHaptic)();
        })
        .onTouchesUp((event, manager) => {
          'worklet';
          for (const touch of event.changedTouches) {
            if (touch.id === activePointerId.value) {
              activePointerId.value = -1;
              setButtonReleased(bit);
              active.value = withSpring(1, {
  stiffness: 900,
  damping: 10,
  mass: 0.35,
});
              manager.end();
              break;  
            }
          }
        })
        .onTouchesCancelled((event, manager) => {
          'worklet';
          for (const touch of event.changedTouches) {
            if (touch.id === activePointerId.value) {
              activePointerId.value = -1;
              setButtonReleased(bit);
              active.value = withSpring(1, { damping: 16, stiffness: 450 });
              manager.end();
              break;
            }
          }
        })
        .onFinalize(() => {
          'worklet';
          if (activePointerId.value !== -1) {
            activePointerId.value = -1;
            setButtonReleased(bit);
          }
          active.value = withSpring(1, { damping: 12, stiffness: 200 });
        });

      if (simultaneousGestures.length > 0) {
        manualGesture.simultaneousWithExternalGesture(...simultaneousGestures);
      }

      return manualGesture;
    }, [bit, isTrigger, simultaneousGestures]);

    return (
      <GestureDetector gesture={gesture}>
        <Animated.View style={btnAnimStyle}>
          <View style={[styles.ctrlBtn, { backgroundColor: color }, style]}>
            <Text style={[styles.ctrlText, textStyle]}>{label}</Text>
            {isTrigger && <View style={styles.triggerGlow} />}
          </View>
        </Animated.View>
      </GestureDetector>
    );
  };

  // MODE TOGGLE (Mouse / Native Controller)
  // ?????????????????????????????????????????????????????????????????????
  const ModeToggleBtn = () => {
    const toggle = () => {
      setMouseModeEnabled(!mouseMode);
      triggerMediumHaptic();
    };

    return (
      <RNGHTouchable onPress={toggle}>
        <View style={[styles.modeBtn, mouseMode ? styles.modeBtnActive : styles.modeBtnInactive]}>
          <Text style={styles.modeBtnText}>
            {mouseMode ? '🕹 MOUSE' : '🎮 CONTROLLER'}
          </Text>
        </View>
      </RNGHTouchable>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // RAPID FIRE TOGGLE (multi-touch: LT/RT become rapid fire when active)
  // ─────────────────────────────────────────────────────────────
  const RapidFireBtn = () => {
    const toggle = () => {
      setRapidFireMode(!rapidFireOn);
      triggerMediumHaptic();
    };

    return (
      <RNGHTouchable onPress={toggle}>
        <View style={[styles.modeBtn, rapidFireOn ? styles.rapidBtnActive : styles.modeBtnInactive]}>
          <Text style={styles.modeBtnText}>
            {rapidFireOn ? '⚡ RAPID FIRE' : '🛡 NORMAL TRIG'}
          </Text>
        </View>
      </RNGHTouchable>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // CONNECTION LOGIC
  // ─────────────────────────────────────────────────────────────
  const handleConnectTo = async (targetIp) => {
    setLoading(true);
    try {
      await AsyncStorage?.setItem('last_ip', targetIp).catch(() => null);
      resetInputState();
      networkRef.current = new GamepadNetwork(targetIp, 8888, 0);
      setConnected(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => handleConnectTo(ip);

  // ─────────────────────────────────────────────────────────────
  // BUILD SIMULTANEOUS GESTURE COMPOSITION
  // Every named gesture is combined into one simultaneous group so
  // all touches on the screen are always recognised in parallel.
  // ─────────────────────────────────────────────────────────────
  const leftStickGesture  = useMemo(() => makeStickGesture(true),  []);
  const rightStickGesture = useMemo(() => makeStickGesture(false), []);
  leftStickGesture.simultaneousWithExternalGesture(rightStickGesture);
  rightStickGesture.simultaneousWithExternalGesture(leftStickGesture);
  const sharedSimultaneousGestures = [leftStickGesture, rightStickGesture];


  // ─────────────────────────────────────────────────────────────
  // LOGIN SCREEN
  // ─────────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <StatusBar barStyle="light-content" />
        <Animated.View style={[styles.loginRoot, loginStyle]}>
          <View style={styles.loginCard}>
            <Text style={styles.loginTitle}>
              PAD<Text style={{ color: C.purple }}>X</Text>
            </Text>
            <Text style={styles.loginSubtitle}>ULTRA-LOW LATENCY UDP CONTROLLER</Text>

            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.loginInput}
                value={ip}
                onChangeText={setIp}
                keyboardType="numeric"
                placeholder="SERVER IP ADDRESS"
                placeholderTextColor="#333"
              />
            </View>

            <RNGHTouchable onPress={handleConnect} disabled={loading}>
              <View style={styles.loginBtn}>
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={styles.loginBtnText}>ESTABLISH LINK</Text>
                }
              </View>
            </RNGHTouchable>
          </View>

          <Text style={styles.footerText}>v3.1.0-PRO | BUILD 2026.05</Text>
        </Animated.View>
      </GestureHandlerRootView>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // MAIN GAMEPAD CANVAS — 5-column responsive flex layout
  //
  //  [Col1: LT+LB / D-Pad] [Col2: L-Stick] [Col3: Center] [Col4: R-Stick] [Col5: RB+RT / ABXY]
  //
  //  Col1 & Col5 are fixed width; Col2 & Col4 are flex-based;
  //  Col3 takes remaining space.
  // ─────────────────────────────────────────────────────────────
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <Animated.View style={[styles.padContainer, padContainerStyle]}>

        {/* ── GAME AREA ROW ── */}
        <View pointerEvents="box-none" style={styles.gameArea}>

          {/* ═══════════════════════════════════════════════
              COLUMN 1 — Left Shoulder (top) + D-Pad (bottom)
              ═══════════════════════════════════════════════ */}
          <View pointerEvents="box-none" style={styles.col1}>

            {/* Left Shoulder Row: LT | LB */}
            <View style={styles.shoulderRow}>
              <ControlBtn
                label="LT"
                bit={Buttons.LT}
                isTrigger
                color="#111"
                style={styles.shoulderBtn}
                textStyle={styles.shoulderText}
                simultaneousGestures={sharedSimultaneousGestures}
              />
              <ControlBtn
                label="LB"
                bit={Buttons.LB}
                color="#111"
                style={styles.shoulderBtn}
                textStyle={styles.shoulderText}
              />
            </View>

            {/* D-Pad */}
            <View style={styles.dpad}>
              <ControlBtn label="▲" bit={Buttons.UP}    style={styles.dBtn} />
              <View style={styles.dRow}>
                <ControlBtn label="◀" bit={Buttons.LEFT}  style={styles.dBtn} />
                <View style={styles.dCenter} />
                <ControlBtn label="▶" bit={Buttons.RIGHT} style={styles.dBtn} />
              </View>
              <ControlBtn label="▼" bit={Buttons.DOWN}  style={styles.dBtn} />
            </View>

          </View>

          {/* ═══════════════════════════════════════════════
              COLUMN 2 — Left Joystick (top-aligned)
              ═══════════════════════════════════════════════ */}
          <View pointerEvents="box-none" style={styles.col2}>
            <GestureDetector gesture={leftStickGesture}>
              <View collapsable={false} style={styles.stickBase}>
                <Animated.View style={[styles.stickHandle, leftStickStyle]} />
              </View>
            </GestureDetector>
          </View>

          {/* ═══════════════════════════════════════════════
              COLUMN 3 — Center (BACK/START, toggles, logo)
              ═══════════════════════════════════════════════ */}
          <View style={styles.col3}>
            <View style={styles.col3Top}>
              <View style={styles.menuRow}>
                <ControlBtn
                  label="BACK"
                  bit={Buttons.BACK}
                  color="rgba(255,255,255,0.05)"
                  style={styles.menuBtn}
                  textStyle={styles.menuText}
                  simultaneousGestures={sharedSimultaneousGestures}
                />
                <ControlBtn
                  label="START"
                  bit={Buttons.START}
                  color="rgba(255,255,255,0.05)"
                  style={styles.menuBtn}
                  textStyle={styles.menuText}
                />
              </View>
            </View>

            <Animated.Text style={[styles.zapLogo, logoStyle]}>PADX</Animated.Text>

            <View style={styles.col3Bottom}>
              <View style={styles.togglesRow}>
                <ModeToggleBtn />
                <RapidFireBtn />
              </View>

              {/* Tap to disconnect */}
              <RNGHTouchable onPress={handleDisconnect}>
                <View style={styles.disconnectZone}>
                  <Animated.View style={[styles.statusDot, statusStyle]} />
                </View>
              </RNGHTouchable>
            </View>
          </View>

          {/* ═══════════════════════════════════════════════
              COLUMN 4 — Right Joystick (bottom-aligned)
              ═══════════════════════════════════════════════ */}
          <View pointerEvents="box-none" style={styles.col4}>
            <GestureDetector gesture={rightStickGesture}>
              <View collapsable={false} style={styles.stickBase}>
                <Animated.View style={[styles.stickHandle, rightStickStyle]} />
              </View>
            </GestureDetector>
          </View>

          {/* ═══════════════════════════════════════════════
              COLUMN 5 — Right Shoulder (top) + ABXY (bottom)
              Layout: RB | RT on top row
              ABXY cluster: Top=Y(yellow), Left=X(blue), Right=B(red), Bottom=A(green)
              ═══════════════════════════════════════════════ */}
          <View pointerEvents="box-none" style={styles.col5}>

            {/* Right Shoulder Row: RB | RT */}
            <View style={styles.shoulderRow}>
              <ControlBtn
                label="RB"
                bit={Buttons.RB}
                color="#111"
                style={styles.shoulderBtn}
                textStyle={styles.shoulderText}
              />
              <ControlBtn
                label="RT"
                bit={Buttons.RT}
                isTrigger
                color="#111"
                style={styles.shoulderBtn}
                textStyle={styles.shoulderText}
              />
            </View>

            {/* ABXY Cluster */}
            <View style={styles.abxy}>
              {/* Top: Y */}
              <ControlBtn
                label="Y"
                bit={Buttons.Y}
                color={C.warning}
                style={styles.actionBtn}
                textStyle={{ color: C.textDark }}
                simultaneousGestures={sharedSimultaneousGestures}
              />
              {/* Middle row: X | spacer | B */}
              <View style={styles.actionRow}>
                <ControlBtn
                  label="X"
                  bit={Buttons.X}
                  color={C.blue}
                  style={styles.actionBtn}
                  simultaneousGestures={sharedSimultaneousGestures}
                />
                <View style={styles.actionSpacer} />
                <ControlBtn
                  label="B"
                  bit={Buttons.B}
                  color={C.danger}
                  style={styles.actionBtn}
                  simultaneousGestures={sharedSimultaneousGestures}
                />
              </View>
              {/* Bottom: A */}
              <ControlBtn
                label="A"
                bit={Buttons.A}
                color={C.accent}
                style={styles.actionBtn}
                textStyle={{ color: C.textDark }}
                simultaneousGestures={sharedSimultaneousGestures}
              />
            </View>

          </View>

        </View>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLESHEET
// ─────────────────────────────────────────────────────────────
const COL_SIDE_W = Math.round(SCREEN_W * 0.18);   // ~18% each side
const COL_STICK_W = Math.round(SCREEN_W * 0.22);  // ~22% stick columns
const STICK_SIZE  = Math.round(SCREEN_H * 0.42);  // stick circle diameter (reduced to prevent overlap)
const HANDLE_SIZE = Math.round(STICK_SIZE * 0.55);
const DPAD_BTN    = Math.round(SCREEN_H * 0.105);
const ACTION_BTN  = Math.round(SCREEN_H * 0.12);
const SHOULDER_W  = Math.round(COL_SIDE_W * 0.55); // slightly wider relative to new side width
const SHOULDER_H  = Math.round(SCREEN_H * 0.10);

const styles = StyleSheet.create({
  // ── SHARED ──────────────────────────────────────────────────
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // ── LOGIN ───────────────────────────────────────────────────
  loginRoot: {
    flex: 1,
    backgroundColor: '#030303',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    width: '100%',
  },
  loginCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  loginTitle: {
    fontSize: 60,
    fontWeight: '900',
    color: C.accent,
    letterSpacing: 4,
  },
  loginSubtitle: {
    color: C.textDim,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 44,
    marginTop: 6,
    fontWeight: '700',
    textAlign: 'center',
  },
  inputWrapper: {
    width: '100%',
    backgroundColor: '#101010',
    borderRadius: 18,
    paddingHorizontal: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  loginInput: {
    height: 62,
    color: C.accent,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  loginBtn: {
    width: '100%',
    minWidth: 360,
    height: 62,
    backgroundColor: C.accent,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginBtnText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  footerText: {
    position: 'absolute',
    bottom: 30,
    color: '#2a2a2a',
    fontSize: 10,
    letterSpacing: 1,
  },

  // ── GAMEPAD CONTAINER ────────────────────────────────────────
  padContainer: {
  flex: 1,
  width: '95%',
  alignSelf: 'center',
},

gameArea: {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'stretch',
  justifyContent: 'space-between',
  paddingHorizontal: 12,
  paddingVertical: 12,
},
  // ── COLUMNS ─────────────────────────────────────────────────
  col1: {
    width: COL_SIDE_W,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  col2: {
    width: COL_STICK_W,
    justifyContent: 'flex-start',   // left stick sits near top
    alignItems: 'center',
    paddingTop: Math.round(SCREEN_H * 0.06),
  },
  col3: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  col3Top: {
    alignItems: 'center',
  },
  col3Bottom: {
    alignItems: 'center',
    gap: 16,
  },
  togglesRow: {
    flexDirection: 'column', // Stack vertically to save horizontal space
    gap: 10,
  },
  col4: {
    width: COL_STICK_W,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: Math.round(SCREEN_H * 0.08),
  },
  col5: {
    width: COL_SIDE_W,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },

  // ── SHOULDER BUTTONS ─────────────────────────────────────────
  // ── SHOULDER BUTTONS ─────────────────────────────────────────

shoulderRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  paddingHorizontal: 6,
},

shoulderBtn: {
  width: SHOULDER_W,
  height: SHOULDER_H,

  justifyContent: 'center',
  alignItems: 'center',

  backgroundColor: '#171717',

  borderRadius: 16,

  borderWidth: 1,
  borderColor: '#2F2F2F',

  overflow: 'hidden',
},

shoulderText: {
  color: '#F5F5F5',

  fontSize: 17,

  fontWeight: '800',

  letterSpacing: 0.6,

  textAlign: 'center',
},

  // ── JOYSTICK ─────────────────────────────────────────────────
  stickBase: {
    width: STICK_SIZE,
    height: STICK_SIZE,
    borderRadius: STICK_SIZE / 2,
    backgroundColor: 'rgba(5,5,5,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
  },
  stickHandle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    // Subtle inner highlight
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },

  // ── D-PAD ────────────────────────────────────────────────────
    dpad: {
      alignItems: 'center',
      justifyContent: 'center',
        padding: 6,
    },
  dRow: {
    flexDirection: 'row',
    alignItems: 'center',
      justifyContent: 'center',
  },
  dCenter: {
    width: DPAD_BTN,
    height: DPAD_BTN,
    backgroundColor: 'rgba(15,15,15,0.5)',
    borderRadius: 8,
  },
  dBtn: {
  width: DPAD_BTN,
  height: DPAD_BTN,

  margin: 5,

  justifyContent: 'center',
  alignItems: 'center',

  backgroundColor: '#181818',

  borderRadius: DPAD_BTN / 2,

  borderWidth: 1.2,
  borderColor: 'rgba(255,255,255,0.12)',

  shadowColor: '#000',
  shadowOffset: {
    width: 0,
    height: 5,
  },
  shadowOpacity: 0.35,
  shadowRadius: 7,

  elevation: 6,
},

  // ── CENTER PANEL ─────────────────────────────────────────────
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  menuBtn: {
    width: 82,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(25,25,25,0.6)',
  },
  menuText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ddd',
    letterSpacing: 1.5,
  },
  modeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: 'rgba(0, 210, 255, 0.12)',
    borderColor: 'rgba(0, 210, 255, 0.5)',
  },
  modeBtnInactive: {
    backgroundColor: 'rgba(20, 20, 20, 0.7)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rapidBtnActive: {
    backgroundColor: 'rgba(255, 63, 63, 0.12)',
    borderColor: 'rgba(255, 63, 63, 0.5)',
  },
  modeBtnText: {
    color: '#ddd',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  zapLogo: {
    color: C.accent,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 8,
  },
  disconnectZone: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(20,20,20,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statusDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
  },

  // ── ABXY CLUSTER ─────────────────────────────────────────────
  abxy: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionSpacer: {
    width: ACTION_BTN * 0.4,
  },
  actionBtn: {
    width: ACTION_BTN,
    height: ACTION_BTN,
    borderRadius: ACTION_BTN / 2,
    margin: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(15,15,15,0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },

  // ── GENERIC CONTROL BUTTON ───────────────────────────────────
  ctrlBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctrlText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },

  // LT / RT glow stripe
  triggerGlow: {
    position: 'absolute',
    top: 0,
    left: '18%',
    right: '18%',
    height: 4,
    backgroundColor: C.accent,
    borderRadius: 2,
    opacity: 1,
  },
});

