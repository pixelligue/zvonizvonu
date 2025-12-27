import { useState, useCallback, useRef } from 'react';

export function useScreenShare() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startSharing = useCallback(async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // захватываем и аудио экрана если возможно
      });

      streamRef.current = displayStream;
      setStream(displayStream);
      setIsSharing(true);
      setError(null);

      // Обработка остановки через системный UI
      displayStream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

      return displayStream;
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError') {
        setError('Доступ к экрану отклонён');
      } else {
        setError('Не удалось начать демонстрацию');
      }
      return null;
    }
  }, []);

  const stopSharing = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setIsSharing(false);
  }, []);

  return { stream, isSharing, error, startSharing, stopSharing };
}
