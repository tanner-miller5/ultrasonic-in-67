import React, { useState, useEffect, useRef } from 'react';

const UltrasonicIn67 = () => {
    // --- STATE ---
    const [isPlayingGen, setIsPlayingGen] = useState(false); // Generator State
    const [isRecording, setIsRecording] = useState(false);
    const [recordingUrl, setRecordingUrl] = useState(null);

    // Settings
    const [enableUltrasonic, setEnableUltrasonic] = useState(true); // Default ON for testing
    const [enableAudible, setEnableAudible] = useState(true);

    // Visualizer State
    const [detected, setDetected] = useState(false);
    const [status, setStatus] = useState("Ready");

    // --- REFS ---
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);

    // Generator Refs
    const oscAudibleRef = useRef(null);
    const oscUltrasonicRef = useRef(null);

    // Recorder Refs
    const recorderNodeRef = useRef(null);
    const audioChunksRef = useRef([]);

    // Playback Refs (THE FIX)
    const audioPlayerRef = useRef(null);      // The HTML <audio> element
    const playerSourceNodeRef = useRef(null); // The WebAudio node for the player

    const canvasRef = useRef(null);
    const animationRef = useRef(null);

    // Constants
    const ULTRASONIC_FREQ = 20000;
    const AUDIBLE_FREQ = 440;

    // --- INITIALIZATION ---
    const initAudioContext = () => {
        if (!audioContextRef.current) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContext();

            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 2048;
            analyserRef.current = analyser;
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };

    // --- 1. SIGNAL GENERATOR ---
    const startGenerator = () => {
        initAudioContext();
        const ctx = audioContextRef.current;

        // Create new Gain Node for the mix
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(analyserRef.current);     // Send to Visualizer
        analyserRef.current.connect(ctx.destination); // Send to Speakers

        // Audible Oscillator
        if (enableAudible) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(AUDIBLE_FREQ, ctx.currentTime);
            const gain = ctx.createGain();
            gain.gain.value = 0.1;
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            oscAudibleRef.current = osc;
        }

        // Ultrasonic Oscillator
        if (enableUltrasonic) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(ULTRASONIC_FREQ, ctx.currentTime);
            const gain = ctx.createGain();
            gain.gain.value = 0.4; // Slightly louder to ensure capture
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            oscUltrasonicRef.current = osc;
        }

        setIsPlayingGen(true);
        setStatus("GENERATING SIGNAL...");
        drawSpectrum(); // Start the loop
    };

    const stopGenerator = () => {
        if (oscAudibleRef.current) { oscAudibleRef.current.stop(); oscAudibleRef.current.disconnect(); }
        if (oscUltrasonicRef.current) { oscUltrasonicRef.current.stop(); oscUltrasonicRef.current.disconnect(); }

        // Stop recording if valid
        if (isRecording) stopRecording();

        setIsPlayingGen(false);
        setStatus("Generator Stopped.");
    };

    // --- 2. LOSSLESS RECORDER (WAV) ---
    const startRecording = () => {
        if (!isPlayingGen) return;
        const ctx = audioContextRef.current;
        audioChunksRef.current = [];

        // ScriptProcessor to capture raw buffer
        const recorder = ctx.createScriptProcessor(4096, 2, 2);
        recorder.onaudioprocess = (e) => {
            const left = e.inputBuffer.getChannelData(0);
            const right = e.inputBuffer.getChannelData(1);
            // Interleave and store
            const interleaved = new Float32Array(left.length + right.length);
            let idx = 0;
            for (let i = 0; i < left.length; i++) {
                interleaved[idx++] = left[i];
                interleaved[idx++] = right[i];
            }
            audioChunksRef.current.push(interleaved);
        };

        // Connect Analyser -> Recorder -> Destination (Silent passthrough)
        analyserRef.current.connect(recorder);
        recorder.connect(ctx.destination);

        recorderNodeRef.current = recorder;
        setIsRecording(true);
        setStatus("● RECORDING WAV...");
    };

    const stopRecording = () => {
        if (recorderNodeRef.current) {
            recorderNodeRef.current.disconnect();
            recorderNodeRef.current = null;
            setIsRecording(false);
            encodeWavFile(); // Process the buffer
        }
    };

    const encodeWavFile = () => {
        setStatus("Encoding WAV...");
        const ctx = audioContextRef.current;
        const recordedBuffers = audioChunksRef.current;

        // Flatten buffers
        const bufferLength = recordedBuffers.reduce((acc, buf) => acc + buf.length, 0);
        const samples = new Float32Array(bufferLength);
        let offset = 0;
        for (const buf of recordedBuffers) {
            samples.set(buf, offset);
            offset += buf.length;
        }

        // Write WAV Headers
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, ctx.sampleRate, true);
        view.setUint32(28, ctx.sampleRate * 4, true);
        view.setUint16(32, 4, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let index = 44;
        for (let i = 0; i < samples.length; i++) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(index, s, true);
            index += 2;
        }

        const blob = new Blob([view], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
        setStatus("WAV Ready. Load below to test.");
    };

    // --- 3. THE BRIDGE (Connect Player -> Visualizer) ---
    const handlePlayFile = () => {
        initAudioContext();
        const ctx = audioContextRef.current;
        const player = audioPlayerRef.current;

        if (!player) return;

        // Create the MediaElementSource ONLY ONCE
        if (!playerSourceNodeRef.current) {
            try {
                const source = ctx.createMediaElementSource(player);
                playerSourceNodeRef.current = source;

                // CONNECT TO VISUALIZER
                source.connect(analyserRef.current);
                analyserRef.current.connect(ctx.destination);
            } catch (e) {
                console.log("Source already connected or CORS issue", e);
            }
        }

        // Ensure Context is running
        if (ctx.state === 'suspended') ctx.resume();

        // Start Visualizer Loop if not running
        drawSpectrum();
        setStatus("Playing Recorded File (Analyzing...)");
    };

    // --- VISUALIZER ENGINE ---
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

            // Draw Background
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let x = 0;

            // Draw Bars
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = dataArray[i];
                const frequency = i * (audioContextRef.current.sampleRate / 2) / bufferLength;

                // Color Coding
                if (frequency > 19000) ctx.fillStyle = `rgb(0, ${barHeight + 100}, 255)`; // Cyan (Ultrasonic)
                else ctx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`; // Red (Audible)

                ctx.fillRect(x, height - barHeight / 2, barWidth, barHeight / 2);
                x += barWidth + 1;
            }

            // Detection Logic
            const nyquist = audioContextRef.current.sampleRate / 2;
            // Look for energy around 20kHz
            const indexStart = Math.floor((19500 / nyquist) * bufferLength);
            const indexEnd = Math.floor((20500 / nyquist) * bufferLength);
            let energy = 0;
            for (let i = indexStart; i <= indexEnd; i++) energy += dataArray[i];

            if (energy > 30) setDetected(true);
            else setDetected(false);

            animationRef.current = requestAnimationFrame(render);
        };
        render();
    };

    useEffect(() => {
        return () => {
            if(animationRef.current) cancelAnimationFrame(animationRef.current);
            stopGenerator();
        }
    }, []);

    return (
        <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '640px', margin: '0 auto', background: '#222', color: '#fff', borderRadius: '12px' }}>
            <h2 style={{ borderBottom: '1px solid #444', paddingBottom: '10px' }}>Ultrasonic-in-67 <span style={{fontSize:'0.6em', color: '#00d8ff'}}>Analyzer Bridge</span></h2>

            {/* 1. CONTROLS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div style={{ padding: '15px', background: '#333', borderRadius: '8px' }}>
                    <h4 style={{marginTop:0}}>Generator</h4>
                    <label style={{ display: 'block', marginBottom: '5px' }}>
                        <input type="checkbox" checked={enableAudible} onChange={(e) => setEnableAudible(e.target.checked)} disabled={isPlayingGen} />
                        Audible (440 Hz)
                    </label>
                    <label style={{ display: 'block', color: '#00d8ff' }}>
                        <input type="checkbox" checked={enableUltrasonic} onChange={(e) => setEnableUltrasonic(e.target.checked)} disabled={isPlayingGen} />
                        Ultrasonic (20kHz)
                    </label>
                    <div style={{marginTop: '15px'}}>
                        {!isPlayingGen ?
                            <button onClick={startGenerator} style={{ width:'100%', padding: '8px', background: '#28a745', border: 'none', color: '#fff', fontWeight:'bold', cursor: 'pointer' }}>START GEN</button> :
                            <button onClick={stopGenerator} style={{ width:'100%', padding: '8px', background: '#dc3545', border: 'none', color: '#fff', fontWeight:'bold', cursor: 'pointer' }}>STOP GEN</button>
                        }
                    </div>
                </div>

                <div style={{ padding: '15px', background: '#333', borderRadius: '8px' }}>
                    <h4 style={{marginTop:0}}>Recorder (WAV)</h4>
                    <p style={{fontSize: '0.8em', color: '#aaa'}}>Records raw output to test if freq is preserved.</p>
                    {isPlayingGen && !isRecording && (
                        <button onClick={startRecording} style={{ width:'100%', padding: '8px', background: '#ffc107', border: 'none', color: '#000', fontWeight:'bold', cursor: 'pointer' }}>● RECORD</button>
                    )}
                    {isRecording && (
                        <button onClick={stopRecording} style={{ width:'100%', padding: '8px', background: '#fd7e14', border: 'none', color: '#fff', fontWeight:'bold', cursor: 'pointer' }}>■ STOP & SAVE</button>
                    )}
                    {!isPlayingGen && !isRecording && <div style={{color: '#666', fontSize:'0.9em'}}>Start Generator first</div>}
                </div>
            </div>

            {/* 2. VISUALIZER */}
            <div style={{ position: 'relative', border: '1px solid #555', borderRadius: '4px', overflow: 'hidden', background: '#000', marginBottom: '20px' }}>
                <canvas ref={canvasRef} width="600" height="150" style={{ display: 'block', width: '100%' }} />

                <div style={{ position: 'absolute', top: 10, left: 10, fontSize: '12px', background: 'rgba(0,0,0,0.8)', padding: '4px 8px', borderRadius: '4px', border: '1px solid #444' }}>
                    {status}
                </div>

                <div style={{ position: 'absolute', top: 10, right: 10, padding: '5px 10px', background: detected ? 'rgba(0, 216, 255, 0.9)' : 'rgba(30,30,30,0.9)', color: detected ? '#000' : '#888', fontWeight: 'bold', borderRadius: '20px', border: detected ? '2px solid #fff' : '1px solid #555'}}>
                    {detected ? '● ULTRASONIC FOUND' : '○ NO SIGNAL'}
                </div>
            </div>

            {/* 3. PLAYER BRIDGE */}
            {recordingUrl && (
                <div style={{ padding: '15px', background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px' }}>
                    <h4 style={{marginTop:0, color: '#00d8ff'}}>Testing Zone</h4>
                    <p style={{fontSize: '0.9em'}}>
                        1. <a href={recordingUrl} download="ultrasonic_test.wav" style={{color: '#fff'}}>Download WAV</a> <br/>
                        2. Play it here to see if the visualizer lights up:
                    </p>

                    <audio
                        ref={audioPlayerRef}
                        src={recordingUrl}
                        controls
                        onPlay={handlePlayFile} // THIS IS THE KEY EVENT
                        style={{ width: '100%' }}
                    />
                </div>
            )}
        </div>
    );
};

export default UltrasonicIn67;