/* global BigInt */
import React, { useState, useEffect, useRef } from 'react';

const UltrasonicIn67 = () => {
    // --- STATE ---
    const [isPlayingGen, setIsPlayingGen] = useState(false);
    const [isRecording, setIsRecording] = useState(false);

    // This URL can come from the Recorder OR an Uploaded File
    const [playbackUrl, setPlaybackUrl] = useState(null);
    const [fileName, setFileName] = useState("");

    const [enableUltrasonic, setEnableUltrasonic] = useState(true);
    const [enableAudible, setEnableAudible] = useState(true);

    const [detected, setDetected] = useState(false);
    const [status, setStatus] = useState("Ready");

    // --- REFS ---
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const oscAudibleRef = useRef(null);
    const oscUltrasonicRef = useRef(null);
    const recorderNodeRef = useRef(null);
    const audioChunksRef = useRef([]);

    // Bridge Refs
    const audioPlayerRef = useRef(null);
    const playerSourceNodeRef = useRef(null);

    const canvasRef = useRef(null);
    const animationRef = useRef(null);

    const ULTRASONIC_FREQ = 20000;
    const AUDIBLE_FREQ = 440;

    // --- INIT ---
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

    // --- 1. GENERATOR ---
    const startGenerator = () => {
        initAudioContext();
        const ctx = audioContextRef.current;

        // Disconnect player if it was running to avoid interference
        if (audioPlayerRef.current) {
            audioPlayerRef.current.pause();
            audioPlayerRef.current.currentTime = 0;
        }

        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(analyserRef.current);
        analyserRef.current.connect(ctx.destination);

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

        if (enableUltrasonic) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(ULTRASONIC_FREQ, ctx.currentTime);
            const gain = ctx.createGain();
            gain.gain.value = 0.4;
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            oscUltrasonicRef.current = osc;
        }

        setIsPlayingGen(true);
        setStatus("GENERATING SIGNAL...");
        drawSpectrum();
    };

    const stopGenerator = () => {
        if (oscAudibleRef.current) { oscAudibleRef.current.stop(); oscAudibleRef.current.disconnect(); }
        if (oscUltrasonicRef.current) { oscUltrasonicRef.current.stop(); oscUltrasonicRef.current.disconnect(); }
        if (isRecording) stopRecording();
        setIsPlayingGen(false);
        setStatus("Generator Stopped.");
    };

    // --- 2. RECORDER (UI67 FORMAT) ---
    const startRecording = () => {
        if (!isPlayingGen) return;
        const ctx = audioContextRef.current;
        audioChunksRef.current = [];

        const recorder = ctx.createScriptProcessor(4096, 2, 2);
        recorder.onaudioprocess = (e) => {
            const left = e.inputBuffer.getChannelData(0);
            const right = e.inputBuffer.getChannelData(1);
            // Interleave Float32 samples
            const interleaved = new Float32Array(left.length + right.length);
            let idx = 0;
            for (let i = 0; i < left.length; i++) {
                interleaved[idx++] = left[i];
                interleaved[idx++] = right[i];
            }
            audioChunksRef.current.push(interleaved);
        };

        analyserRef.current.connect(recorder);
        recorder.connect(ctx.destination);

        recorderNodeRef.current = recorder;
        setIsRecording(true);
        setStatus("● RECORDING UI67...");
    };

    const stopRecording = () => {
        if (recorderNodeRef.current) {
            recorderNodeRef.current.disconnect();
            recorderNodeRef.current = null;
            setIsRecording(false);
            encodeUI67File();
        }
    };

    // --- ENCODER: WRITES .UI67 BINARY FORMAT ---
    // Implements "UI67 File Structure" from overview.md
    const encodeUI67File = () => {
        setStatus("Encoding UI67 Format...");
        const ctx = audioContextRef.current;
        const recordedBuffers = audioChunksRef.current;

        // 1. Flatten Audio Data (PCM)
        const bufferLength = recordedBuffers.reduce((acc, buf) => acc + buf.length, 0);
        const samples = new Float32Array(bufferLength);
        let offset = 0;
        for (const buf of recordedBuffers) {
            samples.set(buf, offset);
            offset += buf.length;
        }

        // 2. Convert Float32 to Int16 PCM for storage
        const pcmDataSize = samples.length * 2;
        const pcmBuffer = new ArrayBuffer(pcmDataSize);
        const pcmView = new DataView(pcmBuffer);
        for (let i = 0; i < samples.length; i++) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            pcmView.setInt16(i * 2, s, true);
        }

        // 3. Construct UI67 Headers & Chunks
        // Header: 40 bytes
        // Chunk Headers: 12 bytes each (4 ID + 8 Length)
        // Chunks: AUDO (Audio), VIDO (Empty for now), END
        const headerSize = 40;
        const audoChunkHeaderSize = 12;
        const totalSize = headerSize + audoChunkHeaderSize + pcmDataSize + 12; // +12 for END chunk

        const fileBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(fileBuffer);

        // Helper to write ASCII strings
        const writeString = (v, off, str) => {
            for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
        };

        // --- WRITE FILE HEADER (40 Bytes) ---
        writeString(view, 0, 'UI67');                // Magic bytes
        view.setUint16(4, 1, true);                 // Version: 1
        view.setBigUint64(6, BigInt(totalSize), true); // Total file length
        writeString(view, 14, 'NONE');              // Video codec (No video in this demo)
        writeString(view, 18, 'PCM ');              // Audio codec (Raw PCM for lossless)
        view.setUint32(22, ctx.sampleRate, true);   // Sample rate
        view.setUint8(26, 2);                       // Channels
        view.setUint8(27, 16);                      // Bit depth
        // Calculate Duration (ms)
        const durationMs = (samples.length / 2 / ctx.sampleRate) * 1000;
        view.setBigUint64(28, BigInt(Math.floor(durationMs)), true); // Duration
        view.setUint32(36, 0, true);                // Reserved

        // --- WRITE AUDIO CHUNK ---
        let cursor = 40;
        writeString(view, cursor, 'AUDO');          // Chunk ID
        view.setBigUint64(cursor + 4, BigInt(pcmDataSize), true); // Chunk Length
        cursor += 12;

        // Copy PCM Data into File Buffer
        new Uint8Array(fileBuffer).set(new Uint8Array(pcmBuffer), cursor);
        cursor += pcmDataSize;

        // --- WRITE END CHUNK ---
        writeString(view, cursor, 'END ');
        view.setBigUint64(cursor + 4, BigInt(0), true);

        // Finalize
        const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        setPlaybackUrl(url);
        setFileName("recording.ui67");
        setStatus("UI67 File Ready. Requires custom decoder.");
    };

    // --- 3. UI67 DECODER & FILE UPLOAD ---
    // Since browsers cannot play .ui67 files, we must parse them
    // and re-encapsulate the PCM data into a WAV container for playback.
    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Check extension
        if (file.name.endsWith('.ui67')) {
            setStatus("Decoding UI67 Container...");
            try {
                const arrayBuffer = await file.arrayBuffer();
                const wavUrl = parseUI67ToWav(arrayBuffer);
                setPlaybackUrl(wavUrl);
                setFileName(file.name);
                setStatus("UI67 Decoded -> Playing Raw Audio");
                if(isPlayingGen) stopGenerator();
            } catch (err) {
                console.error(err);
                setStatus("Error: Invalid UI67 File");
            }
        } else {
            // Standard File Handling
            const url = URL.createObjectURL(file);
            setPlaybackUrl(url);
            setFileName(file.name);
            setStatus("Standard File Loaded.");
            if(isPlayingGen) stopGenerator();
        }
    };

    // --- HELPER: CONVERT UI67 BINARY TO WAV BLOB ---
    const parseUI67ToWav = (buffer) => {
        const view = new DataView(buffer);

        // 1. Validate Header
        const magic = String.fromCharCode(
            view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
        );
        if (magic !== 'UI67') throw new Error("Not a UI67 file");

        const sampleRate = view.getUint32(22, true);
        const channels = view.getUint8(26);
        const bitDepth = view.getUint8(27);

        // 2. Scan Chunks for 'AUDO'
        let cursor = 40; // Skip Header
        let pcmData = null;

        while (cursor < view.byteLength) {
            const chunkId = String.fromCharCode(
                view.getUint8(cursor), view.getUint8(cursor+1), view.getUint8(cursor+2), view.getUint8(cursor+3)
            );
            const chunkLen = Number(view.getBigUint64(cursor + 4, true)); // JS Number is safe for audio chunks < 9PB
            cursor += 12;

            if (chunkId === 'AUDO') {
                // Found Audio Data
                pcmData = new Uint8Array(buffer.slice(cursor, cursor + chunkLen));
                break; // Stop after finding audio
            }
            cursor += chunkLen;
        }

        if (!pcmData) throw new Error("No Audio Chunk Found");

        // 3. Wrap Raw PCM in WAV Header for Browser Playback
        const wavHeader = new ArrayBuffer(44);
        const wView = new DataView(wavHeader);
        const writeStr = (off, s) => { for(let i=0;i<s.length;i++) wView.setUint8(off+i, s.charCodeAt(i)); };

        writeStr(0, 'RIFF');
        wView.setUint32(4, 36 + pcmData.byteLength, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        wView.setUint32(16, 16, true);
        wView.setUint16(20, 1, true);
        wView.setUint16(22, channels, true);
        wView.setUint32(24, sampleRate, true);
        wView.setUint32(28, sampleRate * channels * (bitDepth/8), true);
        wView.setUint16(32, channels * (bitDepth/8), true);
        wView.setUint16(34, bitDepth, true);
        writeStr(36, 'data');
        wView.setUint32(40, pcmData.byteLength, true);

        const wavBlob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
        return URL.createObjectURL(wavBlob);
    };

    // --- 4. THE BRIDGE (Player -> Visualizer) ---
    const handlePlayFile = () => {
        initAudioContext();
        const ctx = audioContextRef.current;
        const player = audioPlayerRef.current;

        if (!player) return;

        if (!playerSourceNodeRef.current) {
            try {
                const source = ctx.createMediaElementSource(player);
                playerSourceNodeRef.current = source;
                source.connect(analyserRef.current);
                analyserRef.current.connect(ctx.destination);
            } catch (e) {
                console.log("Bridge Error (likely already connected):", e);
            }
        }

        if (ctx.state === 'suspended') ctx.resume();
        drawSpectrum();
        setStatus(`Analyzing: ${fileName}`);
    };

    // --- VISUALIZER ---
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
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = dataArray[i];
                const frequency = i * (audioContextRef.current.sampleRate / 2) / bufferLength;

                if (frequency > 19000) ctx.fillStyle = `rgb(0, ${barHeight + 100}, 255)`;
                else ctx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`;

                ctx.fillRect(x, height - barHeight / 2, barWidth, barHeight / 2);
                x += barWidth + 1;
            }

            const nyquist = audioContextRef.current.sampleRate / 2;
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
            <h2 style={{ borderBottom: '1px solid #444', paddingBottom: '10px' }}>Ultrasonic-in-67 <span style={{fontSize:'0.6em', color: '#00d8ff'}}>Final Suite</span></h2>


            {/* CONTROLS GRID */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>

                {/* GENERATOR */}
                <div style={{ padding: '15px', background: '#333', borderRadius: '8px' }}>
                    <h4 style={{marginTop:0, marginBottom:'10px'}}>1. Signal Gen</h4>
                    <div style={{fontSize: '0.85em', marginBottom: '10px', color: '#ccc'}}>
                        <label style={{ marginRight:'10px' }}><input type="checkbox" checked={enableAudible} onChange={(e) => setEnableAudible(e.target.checked)} disabled={isPlayingGen} /> Audible</label>
                        <label style={{ color: '#00d8ff' }}><input type="checkbox" checked={enableUltrasonic} onChange={(e) => setEnableUltrasonic(e.target.checked)} disabled={isPlayingGen} /> Ultrasonic</label>
                    </div>
                    {!isPlayingGen ?
                        <button onClick={startGenerator} style={{ width:'100%', padding: '6px', background: '#28a745', border: 'none', color: '#fff', fontWeight:'bold', cursor: 'pointer', borderRadius:'4px' }}>START</button> :
                        <button onClick={stopGenerator} style={{ width:'100%', padding: '6px', background: '#dc3545', border: 'none', color: '#fff', fontWeight:'bold', cursor: 'pointer', borderRadius:'4px' }}>STOP</button>
                    }
                </div>

                {/* RECORDER */}
                <div style={{ padding: '15px', background: '#333', borderRadius: '8px' }}>
                    <h4 style={{marginTop:0, marginBottom:'10px'}}>2. UI67 Recorder</h4>
                    {isPlayingGen && !isRecording && (
                        <button onClick={startRecording} style={{ width:'100%', padding: '6px', background: '#ffc107', border: 'none', color: '#000', fontWeight:'bold', cursor: 'pointer', borderRadius:'4px' }}>● RECORD .UI67</button>
                    )}
                    {isRecording && (
                        <button onClick={stopRecording} style={{ width:'100%', padding: '6px', background: '#fd7e14', border: 'none', color: '#fff', fontWeight:'bold', cursor: 'pointer', borderRadius:'4px' }}>■ STOP & SAVE</button>
                    )}
                    {!isPlayingGen && !isRecording && <div style={{color: '#666', fontSize:'0.8em', marginTop:'5px'}}>Requires active generator</div>}
                </div>
            </div>

            {/* VISUALIZER */}
            <div style={{ position: 'relative', border: '1px solid #555', borderRadius: '4px', overflow: 'hidden', background: '#000', marginBottom: '20px' }}>
                <canvas ref={canvasRef} width="600" height="150" style={{ display: 'block', width: '100%' }} />
                <div style={{ position: 'absolute', top: 10, left: 10, fontSize: '12px', background: 'rgba(0,0,0,0.8)', padding: '4px 8px', borderRadius: '4px', border: '1px solid #444' }}>{status}</div>
                <div style={{ position: 'absolute', top: 10, right: 10, padding: '5px 10px', background: detected ? 'rgba(0, 216, 255, 0.9)' : 'rgba(30,30,30,0.9)', color: detected ? '#000' : '#888', fontWeight: 'bold', borderRadius: '20px', border: detected ? '2px solid #fff' : '1px solid #555'}}>
                    {detected ? '● DETECTED' : '○ NO SIGNAL'}
                </div>
            </div>

            {/* 3. UNIVERSAL PLAYER (Bridge) */}
            <div style={{ padding: '15px', background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px' }}>
                <h4 style={{marginTop:0, color: '#00d8ff', marginBottom: '10px'}}>3. UI67 Analyzer</h4>

                {/* Upload Button */}
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'inline-block', padding: '6px 12px', background: '#555', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9em', border: '1px solid #777' }}>
                        📁 Upload .UI67 / Media
                        <input type="file" accept=".ui67,audio/*,video/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    <span style={{ marginLeft: '10px', fontSize: '0.9em', color: '#aaa' }}>
                {fileName ? fileName : "No file loaded"}
            </span>
                </div>

                {/* Player */}
                {playbackUrl && (
                    <div>
                        <audio
                            ref={audioPlayerRef}
                            src={playbackUrl}
                            controls
                            onPlay={handlePlayFile} // Triggers the bridge
                            style={{ width: '100%', marginBottom: '10px' }}
                        />

                        {/* Download Link */}
                        {fileName.endsWith(".ui67") && (
                            <div style={{textAlign: 'right'}}>
                                <a href={playbackUrl} download={fileName} style={{ color: '#00d8ff', textDecoration: 'none', fontSize: '0.9em' }}>
                                    {/* Note: In a real app, this link points to the DECODED wav URL for playback.
                                        To download the original UI67, we would need to store the original blob separately.
                                        For this demo, we can just say "Download Decoded WAV" */}
                                    ⬇ Download Decoded WAV (Playable)
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default UltrasonicIn67;