import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { GameAPI, CRANE_GAME_ID, type Sentence } from '../utils/gameApi';

interface GameController {
    nextLevel: () => void;
    restartLevel: () => void;
    toggleMute: () => boolean;
}

export default function Game() {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<GameController | null>(null);

    const [level, setLevel] = useState(0);
    const [gameState, setGameState] = useState<'loading' | 'playing' | 'won' | 'finished'>('loading');
    const [isMuted, setIsMuted] = useState(false);
    const [sentences, setSentences] = useState<string[][]>([]);
    const [gameAPI, setGameAPI] = useState<GameAPI | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [urlGameId, setUrlGameId] = useState<number | null>(null);
    const [urlLessonId, setUrlLessonId] = useState<number | null>(null);

    // Initialize API and load sentences
    useEffect(() => {
        const initGame = async () => {
            try {
                // Read URL parameters
                const urlParams = new URLSearchParams(window.location.search);
                const gameIdParam = urlParams.get('gameId');
                const lessonIdParam = urlParams.get('lessonId');
                const tokenParam = urlParams.get('token');

                if (gameIdParam) setUrlGameId(parseInt(gameIdParam));
                if (lessonIdParam) setUrlLessonId(parseInt(lessonIdParam));

                // Get token from URL or localStorage
                let token = tokenParam || localStorage.getItem('childToken') || sessionStorage.getItem('childToken');

                // If token in URL, save it to localStorage
                if (tokenParam) {
                    localStorage.setItem('childToken', tokenParam);
                    token = tokenParam;
                }

                if (!token) {
                    console.error('No token found! Please login first.');
                    // Fallback to hardcoded sentences
                    setGameState('playing');
                    return;
                }

                const api = new GameAPI(token);
                setGameAPI(api);

                // Fetch sentences from backend
                const gameIdToUse = gameIdParam ? parseInt(gameIdParam) : CRANE_GAME_ID;
                const lessonIdToUse = lessonIdParam ? parseInt(lessonIdParam) : undefined;

                const data = await api.getQuestions(gameIdToUse, lessonIdToUse);

                // Convert Sentence[] to string[][]
                const sentenceWords = data.questions.map(s => s.words);

                if (sentenceWords.length === 0) {
                    console.warn('No sentences found! Using fallback sentences.');
                    setSentences([
                        ["أنا", "أحب", "اللغة", "العربية"],
                        ["المدرسة", "جميلة", "ونظيفة"],
                        ["القطار", "سريع", "جداً"]
                    ]);
                } else {
                    setSentences(sentenceWords);
                    console.log('✅ Loaded', sentenceWords.length, 'sentences from backend');
                }

                // Start game session
                const session = await api.startSession(gameIdToUse, lessonIdToUse);
                setSessionId(session.id);
                console.log('✅ Game session started:', session.id);

                setGameState('playing');
            } catch (error) {
                console.error('Failed to load sentences from backend:', error);
                // Fallback to hardcoded sentences
                setSentences([
                    ["أنا", "أحب", "اللغة", "العربية"],
                    ["المدرسة", "جميلة", "ونظيفة"],
                    ["القطار", "سريع", "جداً"]
                ]);
                setGameState('playing');
            }
        };

        initGame();
    }, []);

    useEffect(() => {
        // Wait until sentences are loaded and game state is 'playing'
        if (gameState !== 'playing' || sentences.length === 0) return;

        const container = containerRef.current;
        if (!container) return;

        let active = true;
        let app: PIXI.Application | null = null;
        let currentLevel = 0;
        let isLevelComplete = false;
        let muted = false;

        // Custom particle class for exhaust smoke
        class SmokeParticle extends PIXI.Graphics {
            vx: number;
            vy: number;
            alphaDecay: number;

            constructor(x: number, y: number, facing: 'left' | 'right') {
                super();
                // Draw a soft grey circle
                this.circle(0, 0, 4 + Math.random() * 6).fill({ color: 0xCCCCCC, alpha: 0.5 });
                this.x = x;
                this.y = y;
                // If facing left, tailpipe is on the right, so exhaust shoots right (positive vx)
                // If facing right, tailpipe is on the left, so exhaust shoots left (negative vx)
                const baseVx = facing === 'left' ? 120 : -120;
                this.vx = baseVx + (Math.random() - 0.5) * 30; // Horizontal exhaust speed
                this.vy = (Math.random() - 0.5) * 15 - 5;      // Minimal vertical movement initially
                this.alphaDecay = 0.8 + Math.random() * 0.4;
            }

            update(dt: number) {
                // Apply air resistance / slowing down
                this.vx *= Math.exp(-2.5 * dt);
                this.vy += -15 * dt;

                this.x += this.vx * dt;
                this.y += this.vy * dt;
                this.alpha -= this.alphaDecay * dt;
                this.scale.x += dt * 0.6;
                this.scale.y += dt * 0.6;
            }
        }

        // Function to load texture and remove pure black background
        const loadTransparentTexture = async (url: string): Promise<PIXI.Texture> => {
            const response = await fetch(url);
            const blob = await response.blob();
            const imageBitmap = await createImageBitmap(blob);

            const canvas = document.createElement('canvas');
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Could not get 2D context");

            ctx.drawImage(imageBitmap, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;

            // Replace black pixels (r<15, g<15, b<15) with transparent
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (r < 15 && g < 15 && b < 15) {
                    data[i + 3] = 0; // Alpha
                }
            }
            ctx.putImageData(imgData, 0, 0);
            return PIXI.Texture.from(canvas);
        };

        const initGame = async () => {
            const localApp = new PIXI.Application();
            await localApp.init({
                autoStart: false,
                width: window.innerWidth,
                height: window.innerHeight,
                backgroundColor: 0x87CEEB,
                resizeTo: window
            });

            if (!active) {
                localApp.destroy(true, { children: true });
                return;
            }

            app = localApp;
            app.start();

            container.appendChild(app.canvas);

            // Load Assets with transparency processing
            let bgTexture: PIXI.Texture | null = null;
            let boxTexture: PIXI.Texture | null = null;
            let truckTexture: PIXI.Texture | null = null;
            let truckClosedTexture: PIXI.Texture | null = null;

            try { bgTexture = await PIXI.Assets.load('/assets/game_background.png'); } catch (e) { }
            try { boxTexture = await loadTransparentTexture('/assets/box.png'); } catch (e) { }
            try { truckTexture = await loadTransparentTexture('/assets/truck.png'); } catch (e) { }
            try { truckClosedTexture = await loadTransparentTexture('/assets/truck_closed.png'); } catch (e) { }

            // Audio setup
            const playSound = (type: string) => {
                if (muted) return;
                try {
                    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    if (type === 'grab') {
                        osc.frequency.setValueAtTime(450, ctx.currentTime);
                        osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.08);
                        gain.gain.setValueAtTime(0.2, ctx.currentTime);
                        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
                        osc.start(); osc.stop(ctx.currentTime + 0.08);
                    } else if (type === 'drop') {
                        osc.frequency.setValueAtTime(320, ctx.currentTime);
                        osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);
                        gain.gain.setValueAtTime(0.25, ctx.currentTime);
                        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
                        osc.start(); osc.stop(ctx.currentTime + 0.12);
                    } else if (type === 'win') {
                        osc.type = 'triangle';
                        const notes = [523.25, 659.25, 783.99, 1046.50];
                        notes.forEach((freq, idx) => {
                            const noteOsc = ctx.createOscillator();
                            const noteGain = ctx.createGain();
                            noteOsc.type = 'triangle';
                            noteOsc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
                            noteGain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.1);
                            noteGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.1 + 0.2);
                            noteOsc.connect(noteGain);
                            noteGain.connect(ctx.destination);
                            noteOsc.start(ctx.currentTime + idx * 0.1);
                            noteOsc.stop(ctx.currentTime + idx * 0.1 + 0.2);
                        });
                    }
                } catch (e) { }
            };

            // Main layers
            const stageContainer = new PIXI.Container();
            app.stage.addChild(stageContainer);

            // Shaker container to wrap game elements
            const gameContainer = new PIXI.Container();
            stageContainer.addChild(gameContainer);

            let bgSprite: PIXI.Sprite | PIXI.Graphics;
            if (bgTexture) {
                bgSprite = new PIXI.Sprite(bgTexture);
                bgSprite.width = app.screen.width;
                bgSprite.height = app.screen.height;
            } else {
                bgSprite = new PIXI.Graphics().rect(0, 0, app.screen.width, app.screen.height).fill(0x87CEEB);
            }
            stageContainer.addChildAt(bgSprite, 0);

            // Set ground Y to match the road in the background image
            const groundY = app.screen.height - 110;

            // Particle lists
            const particles: SmokeParticle[] = [];

            // Truck Container
            const truckContainer = new PIXI.Container();
            truckContainer.x = app.screen.width / 2;
            truckContainer.y = groundY - 60;
            gameContainer.addChild(truckContainer);

            let truckSprite: PIXI.Sprite | null = null;
            let baseScaleX = 1;
            const warningLight = new PIXI.Graphics();

            if (truckTexture) {
                truckSprite = new PIXI.Sprite(truckTexture);
                truckSprite.anchor.set(0.5, 1);
                truckSprite.width = 280;
                truckSprite.height = 186;
                truckSprite.y = 60;
                baseScaleX = truckSprite.scale.x; // Store scaled factor for resizing during flip
                truckContainer.addChild(truckSprite);
                truckContainer.addChild(warningLight);
            } else {
                const truckBody = new PIXI.Graphics()
                    .rect(-120, -60, 240, 60).fill(0xFFFFFF)
                    .rect(-120, -30, 240, 30).fill(0x0000FF)
                    .circle(-80, 0, 20).fill(0x222222)
                    .circle(80, 0, 20).fill(0x222222);
                truckContainer.addChild(truckBody);
                truckContainer.addChild(warningLight);
            }

            // Rope & Hook in World Coordinates
            const rope = new PIXI.Graphics();
            gameContainer.addChild(rope);

            const hook = new PIXI.Graphics()
                .rect(-12, 0, 24, 8).fill(0x333333)
                .rect(-4, 8, 8, 12).fill(0x333333);
            gameContainer.addChild(hook);

            // Crane Tip relative coordinates matching the blue pulley center in the sprite
            const tipXBase = -119;
            const tipYBase = -97;

            // World Hook Physics Variables
            let hookWorldX = truckContainer.x + tipXBase;
            let hookWorldY = groundY - 60 + tipYBase;

            let engineCtx: AudioContext | null = null;
            let engineOsc: OscillatorNode | null = null;
            let engineGain: GainNode | null = null;
            let isEngineRunning = false;

            const initEngineSound = async () => {
                if (muted || isEngineRunning) return;
                try {
                    engineCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                    if (engineCtx.state === 'suspended') {
                        await engineCtx.resume();
                    }
                    engineOsc = engineCtx.createOscillator();
                    engineGain = engineCtx.createGain();

                    engineOsc.type = 'sawtooth';
                    engineOsc.frequency.value = 100; // Raised frequency to be audible on standard speakers
                    engineGain.gain.value = 0.12; // Raised volume

                    const filter = engineCtx.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = 350; // Cut off high frequencies but keep it audible

                    engineOsc.connect(filter);
                    filter.connect(engineGain);
                    engineGain.connect(engineCtx.destination);

                    engineOsc.start();
                    isEngineRunning = true;
                } catch (e) { }
            };

            const resumeAudio = () => {
                if (engineCtx && engineCtx.state === 'suspended') {
                    engineCtx.resume();
                }
            };
            window.addEventListener('click', resumeAudio);
            window.addEventListener('keydown', resumeAudio);

            const state = {
                keys: {} as Record<string, boolean>,
                hookLength: 40,
                maxHookLength: 60 - tipYBase - 35, // Dynamic limit so it stops just above ground
                minHookLength: 40,
                hookSpeed: 220,
                truckSpeed: 320,
                stateGrabbed: null as PIXI.Container | null,
                facing: 'left' as 'left' | 'right',
                shakeTime: 0,
                smokeTimer: 0,
                vibrationTimer: 0,
                blinkTimer: 2.0 + Math.random() * 3.0,
                isBlinking: false,
                blinkDurationTimer: 0
            };

            const keyDownListener = (e: KeyboardEvent) => {
                state.keys[e.key.toLowerCase()] = true;
                state.keys[e.key] = true;
                if (!isEngineRunning) initEngineSound();
            };
            const keyUpListener = (e: KeyboardEvent) => { state.keys[e.key.toLowerCase()] = false; state.keys[e.key] = false; };
            window.addEventListener('keydown', keyDownListener);
            window.addEventListener('keyup', keyUpListener);

            let boxes: PIXI.Container[] = [];
            let slots: { x: number, y: number, expectedWord: string, filledBy: PIXI.Container | null, graphics: PIXI.Graphics }[] = [];

            const boxSize = 80;
            const boxSpriteSize = 135;

            const triggerShake = (time: number) => {
                state.shakeTime = time;
            };

            const buildLevel = () => {
                boxes.forEach(b => b.destroy());
                slots.forEach(s => s.graphics.destroy());
                boxes = [];
                slots = [];
                isLevelComplete = false;
                state.stateGrabbed = null;

                const currentSentenceWords = sentences[currentLevel];
                const words = [...currentSentenceWords].sort(() => Math.random() - 0.5);

                words.forEach((word, index) => {
                    const boxGroup = new PIXI.Container();

                    if (boxTexture) {
                        const boxSprite = new PIXI.Sprite(boxTexture);
                        boxSprite.anchor.set(0.5);
                        boxSprite.width = boxSpriteSize;
                        boxSprite.height = boxSpriteSize;
                        boxGroup.addChild(boxSprite);
                    } else {
                        const boxGraphics = new PIXI.Graphics()
                            .rect(-boxSize / 2, -boxSize / 2, boxSize, boxSize).fill(0xD2B48C)
                            .rect(-boxSize / 2, -boxSize / 2, boxSize, boxSize).stroke({ width: 4, color: 0x8B4513 });
                        boxGroup.addChild(boxGraphics);
                    }

                    const text = new PIXI.Text({
                        text: word,
                        style: { fontFamily: 'Cairo', fontSize: 24, fill: 0x221100, fontWeight: 'bold' }
                    });
                    text.anchor.set(0.5);
                    text.y = boxTexture ? -2 : 0;
                    boxGroup.addChild(text);

                    boxGroup.x = 100 + index * 130 + Math.random() * 30;
                    boxGroup.y = groundY - boxSize / 2;
                    (boxGroup as any).word = word;

                    gameContainer.addChild(boxGroup);
                    boxes.push(boxGroup);
                });

                const targetY = groundY - boxSize / 2;
                const slotsCount = currentSentenceWords.length;
                const slotWidth = 120;
                const startSlotX = app!.screen.width - (slotsCount * slotWidth) - 100;

                for (let i = 0; i < slotsCount; i++) {
                    const slot = new PIXI.Graphics()
                        .rect(-boxSize / 2, -boxSize / 2, boxSize, boxSize).fill({ color: 0x000000, alpha: 0.15 })
                        .rect(-boxSize / 2, -boxSize / 2, boxSize, boxSize).stroke({ width: 2, color: 0xFFFFFF, alpha: 0.6 });

                    slot.x = startSlotX + (slotsCount - 1 - i) * slotWidth + boxSize / 2; // RTL order
                    slot.y = targetY;
                    gameContainer.addChild(slot);
                    slots.push({ x: slot.x, y: slot.y, expectedWord: currentSentenceWords[i], filledBy: null, graphics: slot });
                }
            };

            buildLevel();

            // Game main loop
            const tickerFunc = () => {
                if (!app) return;
                const dt = app.ticker.deltaMS / 1000;

                // Camera Shake physics
                if (state.shakeTime > 0) {
                    state.shakeTime -= dt;
                    gameContainer.x = (Math.random() - 0.5) * 8;
                    gameContainer.y = (Math.random() - 0.5) * 8;
                } else {
                    gameContainer.x = 0;
                    gameContainer.y = 0;
                }

                if (isLevelComplete) return;

                let isMoving = false;

                // Move truck
                if (state.keys['arrowright'] || state.keys['d']) {
                    truckContainer.x += state.truckSpeed * dt;
                    state.facing = 'right';
                    isMoving = true;
                }
                if (state.keys['arrowleft'] || state.keys['a']) {
                    truckContainer.x -= state.truckSpeed * dt;
                    state.facing = 'left';
                    isMoving = true;
                }

                // Limits
                if (truckContainer.x < 150) truckContainer.x = 150;
                if (truckContainer.x > app.screen.width - 150) truckContainer.x = app.screen.width - 150;

                // Engine Sound Update
                if (engineCtx && engineOsc && engineGain) {
                    if (muted) {
                        engineGain.gain.setTargetAtTime(0, engineCtx.currentTime, 0.1);
                    } else {
                        const targetFreq = isMoving ? 220 : 100; // Raised frequencies
                        const targetGain = isMoving ? 0.35 : 0.12; // Raised gains
                        engineOsc.frequency.setTargetAtTime(targetFreq, engineCtx.currentTime, 0.15);
                        engineGain.gain.setTargetAtTime(targetGain, engineCtx.currentTime, 0.15);
                    }
                }

                // Truck visual vibration
                state.vibrationTimer += dt;
                if (truckSprite) {
                    const vibrationAmount = isMoving ? 1.5 : 0.3; // Shake slightly when idle, more when moving
                    const shakeY = Math.sin(state.vibrationTimer * (isMoving ? 60 : 30)) * vibrationAmount;
                    truckSprite.y = 60 + shakeY;
                }

                // Flip Sprite smoothly preserving scale factor
                if (truckSprite) {
                    const targetScale = state.facing === 'left' ? baseScaleX : -baseScaleX;
                    truckSprite.scale.x += (targetScale - truckSprite.scale.x) * 0.25;
                }

                // Blinking logic
                if (truckSprite && truckTexture && truckClosedTexture) {
                    if (state.isBlinking) {
                        state.blinkDurationTimer -= dt;
                        if (state.blinkDurationTimer <= 0) {
                            state.isBlinking = false;
                            truckSprite.texture = truckTexture;
                            state.blinkTimer = 2.0 + Math.random() * 3.0; // Next blink in 2-5 seconds
                        }
                    } else {
                        state.blinkTimer -= dt;
                        if (state.blinkTimer <= 0) {
                            state.isBlinking = true;
                            truckSprite.texture = truckClosedTexture;
                            state.blinkDurationTimer = 0.15; // Blink lasts 150ms
                        }
                    }
                }

                // Warning Light update (flashes when carrying box)
                if (warningLight) {
                    const lightX = state.facing === 'left' ? -2 : 2;
                    warningLight.x = lightX;
                    const shakeY = truckSprite ? truckSprite.y - 60 : 0;
                    warningLight.y = -65 + shakeY; // Positioned exactly above the driver's head on the cab roof

                    if (state.stateGrabbed) {
                        warningLight.visible = true;
                        const blink = Math.floor(app.ticker.lastTime / 150) % 2 === 0;
                        warningLight.clear();
                        // Base bracket
                        warningLight.rect(-8, 0, 16, 4).fill(0x333333);
                        if (blink) {
                            // Flash yellow/orange bulb
                            warningLight.roundRect(-6, -10, 12, 10, 3).fill(0xFFAA00);
                            // Glowing halos
                            warningLight.circle(0, -5, 18).fill({ color: 0xFFCC00, alpha: 0.5 });
                            warningLight.circle(0, -5, 32).fill({ color: 0xFFCC00, alpha: 0.18 });
                        } else {
                            // Dim bulb
                            warningLight.roundRect(-6, -10, 12, 10, 3).fill(0x775500);
                        }
                    } else {
                        // Inactive/Off state: grey bulb
                        warningLight.visible = true;
                        warningLight.clear();
                        warningLight.rect(-8, 0, 16, 4).fill(0x333333);
                        warningLight.roundRect(-6, -10, 12, 10, 3).fill(0x777777);
                    }
                }

                // Calculate the world coordinates of the tip of the crane
                const tipOffsetX = state.facing === 'left' ? tipXBase : -tipXBase;
                const tipWorldX = truckContainer.x + tipOffsetX;
                const tipWorldY = truckContainer.y + tipYBase;

                // Update Hook length
                if (state.keys['arrowdown'] || state.keys['s']) {
                    state.hookLength += state.hookSpeed * dt;
                    if (state.hookLength > state.maxHookLength) state.hookLength = state.maxHookLength;
                }
                if (state.keys['arrowup'] || state.keys['w']) {
                    state.hookLength -= state.hookSpeed * dt;
                    if (state.hookLength < state.minHookLength) state.hookLength = state.minHookLength;
                }

                // Hook Pendulum Physics (Lag behind on X axis when moving)
                const targetHookX = tipWorldX;
                const targetHookY = tipWorldY + state.hookLength;
                hookWorldX += (targetHookX - hookWorldX) * 0.12;
                hookWorldY += (targetHookY - hookWorldY) * 0.2;

                // Draw Rope
                rope.clear()
                    .moveTo(tipWorldX, tipWorldY)
                    .lineTo(hookWorldX, hookWorldY)
                    .stroke({ width: 3, color: 0x222222 });

                // Position Hook
                hook.x = hookWorldX;
                hook.y = hookWorldY;

                // Position grabbed box
                if (state.stateGrabbed) {
                    state.stateGrabbed.x = hookWorldX;
                    state.stateGrabbed.y = hookWorldY + boxSize / 2 - 8;
                }

                // Handle exhaust particles (spawning at the rear bumper)
                state.smokeTimer += dt;
                const spawnInterval = isMoving ? 0.04 : 0.12;
                if (state.smokeTimer >= spawnInterval) {
                    state.smokeTimer = 0;
                    // Exhaust is located at the rear bumper (opposite to cab side)
                    // Cab is on the left, exhaust at the right bumper (x=130)
                    // If flipped right, cab on the right, exhaust at the left bumper (x=-130)
                    const pipeOffsetX = state.facing === 'left' ? 130 : -130;
                    const pipeX = truckContainer.x + pipeOffsetX;
                    const pipeY = truckContainer.y + 15; // Bumper height (raised from 35)

                    const p = new SmokeParticle(pipeX, pipeY, state.facing);
                    gameContainer.addChild(p);
                    particles.push(p);
                }

                // Update & prune particles
                for (let i = particles.length - 1; i >= 0; i--) {
                    const p = particles[i];
                    p.update(dt);
                    if (p.alpha <= 0) {
                        p.destroy();
                        particles.splice(i, 1);
                    }
                }

                // Grabbing (Spacebar)
                if (state.keys[' ']) {
                    if (state.stateGrabbed) {
                        // Drop
                        playSound('drop');
                        triggerShake(0.1);
                        let droppedInSlot = false;
                        for (let slot of slots) {
                            if (!slot.filledBy && Math.abs(hookWorldX - slot.x) < 45 && Math.abs(hookWorldY - slot.y) < 55) {
                                state.stateGrabbed.x = slot.x;
                                state.stateGrabbed.y = slot.y;
                                slot.filledBy = state.stateGrabbed;
                                droppedInSlot = true;
                                checkWinCondition();
                                break;
                            }
                        }

                        if (!droppedInSlot) {
                            // Drop on ground
                            state.stateGrabbed.x = hookWorldX;
                            state.stateGrabbed.y = groundY - boxSize / 2;
                        }

                        state.stateGrabbed = null;
                        state.keys[' '] = false;
                    } else {
                        // Grab
                        for (let box of boxes) {
                            if (Math.abs(box.x - hookWorldX) < boxSize / 2 && Math.abs(box.y - hookWorldY) < boxSize / 2) {
                                playSound('grab');
                                state.stateGrabbed = box;

                                for (let slot of slots) {
                                    if (slot.filledBy === box) slot.filledBy = null;
                                }
                                state.keys[' '] = false;
                                break;
                            }
                        }
                    }
                }
            };
            app.ticker.add(tickerFunc);

            const checkWinCondition = () => {
                let correct = true;
                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    if (!slot.filledBy || (slot.filledBy as any).word !== slot.expectedWord) {
                        correct = false;
                        break;
                    }
                }

                if (correct) {
                    isLevelComplete = true;
                    playSound('win');
                    triggerShake(0.35);

                    setTimeout(() => {
                        if (currentLevel < sentences.length - 1) {
                            setGameState('won');
                        } else {
                            setGameState('finished');

                            // Complete backend session
                            if (gameAPI && sessionId) {
                                gameAPI.completeSession(sessionId).then(result => {
                                    console.log('✅ Session completed:', result);
                                    console.log(`   🪙 Coins: ${result.coins}`);
                                    console.log(`   ⭐ Stars: ${result.stars}`);
                                }).catch(err => {
                                    console.error('❌ Failed to complete session:', err);
                                });
                            }
                        }
                    }, 500);
                }
            };

            // React Controller linkage
            controllerRef.current = {
                nextLevel: () => {
                    if (currentLevel < sentences.length - 1) {
                        currentLevel++;
                        setLevel(currentLevel);
                        setGameState('playing');
                        buildLevel();
                    }
                },
                restartLevel: () => {
                    buildLevel();
                    setGameState('playing');
                },
                toggleMute: () => {
                    muted = !muted;
                    return muted;
                }
            };

            return () => {
                window.removeEventListener('keydown', keyDownListener);
                window.removeEventListener('keyup', keyUpListener);
                window.removeEventListener('click', resumeAudio);
                window.removeEventListener('keydown', resumeAudio);
                if (app) {
                    app.ticker.remove(tickerFunc);
                }
                particles.forEach(p => p.destroy());
                if (engineCtx) {
                    engineCtx.close();
                }
            };
        };

        let cleanup: any;
        initGame().then(fn => cleanup = fn);

        return () => {
            active = false;
            if (cleanup) cleanup();
            if (app) {
                app.stop();
                app.destroy(true, { children: true });
            }
        };
    }, [sentences, gameState, gameAPI, sessionId]);

    const handleNext = () => {
        if (controllerRef.current) {
            controllerRef.current.nextLevel();
        }
    };

    const handleRestart = () => {
        if (controllerRef.current) {
            controllerRef.current.restartLevel();
        }
    };

    const handleMute = () => {
        if (controllerRef.current) {
            const m = controllerRef.current.toggleMute();
            setIsMuted(m);
        }
    };

    return (
        <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', direction: 'rtl' }}>

            {/* HUD: Glassmorphic panel top right */}
            <div className="glass-hud" style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                padding: '15px 25px',
                borderRadius: '16px',
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                backdropFilter: 'blur(16px)',
                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                color: '#fff',
                zIndex: 10,
                fontFamily: "'Cairo', sans-serif",
                minWidth: '240px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 900, textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>المستوى {level + 1}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={handleRestart} title="إعادة تشغيل" style={{
                            background: 'rgba(255,255,255,0.2)',
                            border: 'none',
                            color: 'white',
                            padding: '6px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.2s'
                        }}>
                            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" /></svg>
                        </button>
                        <button onClick={handleMute} title={isMuted ? "تشغيل الصوت" : "كتم الصوت"} style={{
                            background: 'rgba(255,255,255,0.2)',
                            border: 'none',
                            color: 'white',
                            padding: '6px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.2s'
                        }}>
                            {isMuted ? (
                                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.48 4.48 0 0 0 2.5-4zm2.5 0c0-1.77-.45-3.39-1.21-4.8L16.3 8.7a6.993 6.993 0 0 1 .7 3.3c0 1.9-.76 3.61-2 4.89l1.42 1.42A8.9 8.9 0 0 0 19 12zm-12-3H3v6h4l5 5V4L7 9z" /></svg>
                            ) : (
                                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                            )}
                        </button>
                    </div>
                </div>
                <div style={{ fontSize: '14px', opacity: 0.9 }}>
                    قم بترتيب الصناديق لتكوين جملة مفيدة.
                </div>
            </div>



            {/* Success Popup Screen */}
            {gameState !== 'playing' && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 20,
                    fontFamily: "'Cairo', sans-serif"
                }}>
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.92)',
                        border: '2px solid #00AA00',
                        borderRadius: '24px',
                        padding: '40px 60px',
                        textAlign: 'center',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
                        maxWidth: '480px',
                        width: '90%',
                        animation: 'popIn 0.3s ease-out'
                    }}>
                        <div style={{ fontSize: '64px', marginBottom: '10px' }}>🌟🎉</div>

                        {gameState === 'won' ? (
                            <>
                                <h1 style={{ color: '#008800', margin: '0 0 10px 0', fontSize: '36px', fontWeight: 900 }}>عمل رائع!</h1>
                                <p style={{ fontSize: '18px', color: '#333', margin: '0 0 30px 0' }}>لقد قمت بترتيب الجملة بنجاح.</p>
                                <button onClick={handleNext} style={{
                                    background: '#00AA00',
                                    color: 'white',
                                    border: 'none',
                                    padding: '12px 36px',
                                    borderRadius: '30px',
                                    fontSize: '20px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    boxShadow: '0 5px 15px rgba(0, 170, 0, 0.3)',
                                    transition: 'all 0.2s',
                                    width: '100%'
                                }} className="pulse-btn">
                                    المستوى التالي
                                </button>
                            </>
                        ) : (
                            <>
                                <h1 style={{ color: '#D4AF37', margin: '0 0 10px 0', fontSize: '36px', fontWeight: 900 }}>تهانينا!</h1>
                                <p style={{ fontSize: '18px', color: '#333', margin: '0 0 30px 0' }}>لقد أتممت جميع الجمل بنجاح!</p>
                                <button onClick={handleRestart} style={{
                                    background: '#D4AF37',
                                    color: 'white',
                                    border: 'none',
                                    padding: '12px 36px',
                                    borderRadius: '30px',
                                    fontSize: '20px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    boxShadow: '0 5px 15px rgba(212, 175, 55, 0.3)',
                                    transition: 'all 0.2s',
                                    width: '100%'
                                }}>
                                    اللعب مرة أخرى
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Custom animations styles inside React */}
            <style>{`
                @keyframes popIn {
                    0% { transform: scale(0.85); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .pulse-btn {
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.03); }
                    100% { transform: scale(1); }
                }
                button:hover {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                }
                button:active {
                    transform: translateY(1px);
                }
            `}</style>
        </div>
    );
}
