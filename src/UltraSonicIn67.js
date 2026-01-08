import React, { useState, useEffect, useRef } from 'react';

const UltrasonicIn67 = () => {
    // State for UI toggles
    const [isPlaying, setIsPlaying] = useState(false);
    const [enableUltrasonic, setEnableUltrasonic] = useState(false);
    const [enableAudible, setEnableAudible] = useState(true);
    const [detected, setDetected] = useState(false);
    const [status, setStatus] = useState("System Idle");

    // Web Audio API Refs
    const audioContextRef = useRef(null);
    const oscillatorAudibleRef = useRef(null);
    const oscillatorUltrasonicRef = useRef(null);
    const analyserRef = useRef(null);
    const canvasRef = useRef(null);
    const animationRef = useRef(null);

    // Constants
    const ULTRASONIC_FREQ = 20000; // 20 kHz (Borderline ultrasonic)
    const AUDIBLE_FREQ = 440;      // 440 Hz (A4 Note)

    // Initialize Audio Context
    const initAudio = () => {
        if (!audioContextRef.current) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContext();

            // Create Analyzer (The "Decoder")
            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 2048; // High resolution for frequency details
            analyserRef.current = analyser;
        }
    };

    const startAudio = () => {
        initAudio();
        const ctx = audioContextRef.current;

        // Resume context if suspended (browser policy)
        if (ctx.state === 'suspended') ctx.resume();

        // 1. Setup Audible Oscillator (The "Mask")
        if (enableAudible) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(AUDIBLE_FREQ, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime); // Low volume

            osc.connect(gain);
            gain.connect(analyserRef.current);
            gain.connect(ctx.destination);

            osc.start();
            oscillatorAudibleRef.current = osc;
        }

        // 2. Setup Ultrasonic Oscillator (The "Hidden Data")
        if (enableUltrasonic) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(ULTRASONIC_FREQ, ctx.currentTime);
            // NOTE: We do NOT use a BiquadFilter here, preserving the raw high freq.
            gain.gain.setValueAtTime(0.2, ctx.currentTime);

            osc.connect(gain);
            gain.connect(analyserRef.current);
            // We connect to destination so it "plays", even if inaudible to humans
            gain.connect(ctx.destination);

            osc.start();
            oscillatorUltrasonicRef.current = osc;
        }

        setIsPlaying(true);
        setStatus("Encoding & Decoding Stream...");
        drawSpectrum();
    };

    const stopAudio = () => {
        if (oscillatorAudibleRef.current) {
            oscillatorAudibleRef.current.stop();
            oscillatorAudibleRef.current.disconnect();
        }
        if (oscillatorUltrasonicRef.current) {
            oscillatorUltrasonicRef.current.stop();
            oscillatorUltrasonicRef.current.disconnect();
        }
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        setIsPlaying(false);
        setDetected(false);
        setStatus("Stopped");
    };

    // The "Decoder" Visualization Logic
    const drawSpectrum = () => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const width = canvas.width;
        const height = canvas.height;

        const render = () => {
            analyser.getByteFrequencyData(dataArray);

            // Clear Canvas
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, width, height);

            // 1. Draw Frequency Bars
            const barWidth = (width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                barHeight = dataArray[i];

                // Color Logic: Red for Audible, Cyan for Ultrasonic range
                // Note: In 44.1kHz sample rate, bin index maps to freq.
                // Approx: index * 21.5 = Frequency
                const frequency = i * (audioContextRef.current.sampleRate / 2) / bufferLength;

                if (frequency > 19000) {
                    ctx.fillStyle = `rgb(0, ${barHeight + 100}, 255)`; // Cyan for HF
                } else {
                    ctx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`; // Red for LF
                }

                ctx.fillRect(x, height - barHeight / 2, barWidth, barHeight / 2);
                x += barWidth + 1;
            }

            // 2. Ultrasonic Detection Logic (The "Decode" Check)
            // Check bins roughly corresponding to 19k - 21k Hz
            const nyquist = audioContextRef.current.sampleRate / 2;
            const indexStart = Math.floor((19500 / nyquist) * bufferLength);
            const indexEnd = Math.floor((20500 / nyquist) * bufferLength);

            let ultrasonicEnergy = 0;
            for (let i = indexStart; i <= indexEnd; i++) {
                ultrasonicEnergy += dataArray[i];
            }

            // Threshold for detection
            if (ultrasonicEnergy > 50) {
                setDetected(true);
            } else {
                setDetected(false);
            }

            animationRef.current = requestAnimationFrame(render);
        };

        render();
    };

    useEffect(() => {
        return () => stopAudio(); // Cleanup on unmount
    }, []);

    return (
        <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto', background: '#222', color: '#fff', borderRadius: '12px' }}>
            <h2 style={{ borderBottom: '1px solid #444', paddingBottom: '10px' }}>Ultrasonic-in-67 <span style={{fontSize:'0.6em', color: '#888'}}>Prototype</span></h2>

            <div style={{ marginBottom: '20px', padding: '15px', background: '#333', borderRadius: '8px' }}>
                <h4 style={{marginTop:0}}>Encoder Settings</h4>
                <label style={{ display: 'block', marginBottom: '10px', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={enableAudible}
                        onChange={(e) => setEnableAudible(e.target.checked)}
                        disabled={isPlaying}
                    />
                    Enable Audible Carrier (440 Hz)
                </label>
                <label style={{ display: 'block', marginBottom: '10px', cursor: 'pointer', color: '#00d8ff' }}>
                    <input
                        type="checkbox"
                        checked={enableUltrasonic}
                        onChange={(e) => setEnableUltrasonic(e.target.checked)}
                        disabled={isPlaying}
                    />
                    Enable Ultrasonic Payload (20,000 Hz)
                </label>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                {!isPlaying ? (
                    <button
                        onClick={startAudio}
                        style={{ padding: '10px 20px', background: '#28a745', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        Start Encoding Stream
                    </button>
                ) : (
                    <button
                        onClick={stopAudio}
                        style={{ padding: '10px 20px', background: '#dc3545', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        Stop Stream
                    </button>
                )}
            </div>

            <div style={{ position: 'relative', border: '1px solid #555', borderRadius: '4px', overflow: 'hidden' }}>
                <canvas
                    ref={canvasRef}
                    width="560"
                    height="150"
                    style={{ display: 'block', width: '100%' }}
                />

                {/* Overlay Status */}
                <div style={{ position: 'absolute', top: 10, left: 10, fontSize: '12px', background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '4px' }}>
                    Status: {status}
                </div>

                {/* Decoder Signal Indicator */}
                <div style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    padding: '5px 10px',
                    background: detected ? 'rgba(0, 216, 255, 0.9)' : 'rgba(50,50,50,0.8)',
                    color: detected ? '#000' : '#888',
                    fontWeight: 'bold',
                    borderRadius: '20px',
                    border: detected ? '2px solid #fff' : '1px solid #555',
                    transition: 'all 0.2s ease'
                }}>
                    {detected ? '● ULTRASONIC DETECTED' : '○ No HF Signal'}
                </div>
            </div>

            <p style={{ fontSize: '0.8em', color: '#888', marginTop: '15px' }}>
                <strong>Technical Note:</strong> Standard MP4/AAC encoders filter frequencies above 18kHz.
                This application utilizes the Web Audio API to bypass compression filters,
                visualizing the raw High-Frequency content (Cyan bars on the right) that would normally be discarded.
            </p>
        </div>
    );
};

export default UltrasonicIn67;