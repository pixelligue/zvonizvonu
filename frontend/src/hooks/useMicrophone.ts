import { useState, useRef, useCallback } from 'react';

export function useMicrophone() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number>(0);

  const startMic = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      setStream(mediaStream);
      setError(null);

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(mediaStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.fftSize);

      const updateLevel = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const newLevel = Math.min(100, rms * 500);

        setLevel(newLevel);
        rafIdRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch {
      setError('Нет доступа к микрофону');
    }
  }, []);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setLevel(0);
  }, [stream]);

  const toggleMute = useCallback(() => {
    if (stream) {
      const newMuted = !isMuted;
      stream.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
      setIsMuted(newMuted);
    }
  }, [stream, isMuted]);

  return { stream, level, error, isMuted, startMic, stopMic, toggleMute };
}
