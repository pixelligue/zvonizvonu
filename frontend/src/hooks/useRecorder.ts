import { useState, useCallback, useRef } from 'react';

// Скачать blob как файл
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Получить поддерживаемый mimeType
function getSupportedMimeType(): { mimeType: string; extension: string } {
  const types = [
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/webm', extension: 'webm' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
    { mimeType: 'audio/mp4', extension: 'm4a' },
    { mimeType: '', extension: 'webm' }, // default
  ];

  for (const type of types) {
    if (!type.mimeType || MediaRecorder.isTypeSupported(type.mimeType)) {
      return type;
    }
  }

  return types[types.length - 1];
}

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mimeTypeRef = useRef<{ mimeType: string; extension: string }>({ mimeType: '', extension: 'webm' });

  // Добавить аудио поток в микшер
  const addStream = useCallback((stream: MediaStream) => {
    if (!audioCtxRef.current || !destinationRef.current) return;

    try {
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(destinationRef.current);
    } catch (e) {
      console.warn('Failed to add stream to recorder:', e);
    }
  }, []);

  // Начать запись
  const startRecording = useCallback((localStream: MediaStream, remoteStreams: MediaStream[]) => {
    try {
      // Создаём AudioContext для микширования
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // Возобновляем если suspended
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const destination = audioCtx.createMediaStreamDestination();
      destinationRef.current = destination;

      // Добавляем локальный поток
      const localSource = audioCtx.createMediaStreamSource(localStream);
      localSource.connect(destination);

      // Добавляем все удалённые потоки
      remoteStreams.forEach(stream => {
        try {
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(destination);
        } catch (e) {
          console.warn('Failed to add remote stream:', e);
        }
      });

      // Определяем поддерживаемый формат
      const supportedType = getSupportedMimeType();
      mimeTypeRef.current = supportedType;

      // Создаём MediaRecorder
      const options: MediaRecorderOptions = {};
      if (supportedType.mimeType) {
        options.mimeType = supportedType.mimeType;
      }

      const mediaRecorder = new MediaRecorder(destination.stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start(1000); // чанки каждую секунду
      setIsRecording(true);
      setDuration(0);

      // Таймер
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
    } catch (e) {
      console.error('Failed to start recording:', e);
    }
  }, []);

  // Остановить запись и сохранить файл
  const stopRecording = useCallback(() => {
    return new Promise<void>((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve();
        return;
      }

      mediaRecorderRef.current.onstop = async () => {
        // Создаём blob
        const { mimeType, extension } = mimeTypeRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        const filename = `recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${extension}`;

        // Проверяем iOS и поддержку Web Share API
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });

        if (isIOS && canShare) {
          // iOS: используем Web Share API
          try {
            const file = new File([blob], filename, { type: blob.type });
            await navigator.share({
              files: [file],
              title: 'Запись звонка',
            });
          } catch (e) {
            // Пользователь отменил или ошибка — fallback на обычное скачивание
            downloadBlob(blob, filename);
          }
        } else {
          // Обычное скачивание
          downloadBlob(blob, filename);
        }

        // Очистка
        chunksRef.current = [];
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        destinationRef.current = null;

        resolve();
      };

      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    });
  }, []);

  // Форматирование времени
  const formatDuration = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  return {
    isRecording,
    duration,
    formattedDuration: formatDuration(duration),
    startRecording,
    stopRecording,
    addStream,
  };
}
