'use client';

import { memo, useRef, useEffect, useState, useCallback } from 'react';
import { FullscreenIcon, ExitFullscreenIcon, MinimizeIcon, ExpandIcon } from '@/components/icons';

interface ScreenViewerProps {
  stream: MediaStream;
}

export const ScreenViewer = memo(function ScreenViewer({ stream }: ScreenViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Привязать видео к элементу
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isMinimized]);

  // Слушаем выход из fullscreen через Escape
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  }, []);

  const handleMinimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const handleExpand = useCallback(() => {
    setIsMinimized(false);
  }, []);

  // Свёрнутый индикатор
  if (isMinimized) {
    return (
      <button
        onClick={handleExpand}
        className="fixed bottom-24 right-4 z-40 bg-gray-900/90 backdrop-blur-xl text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 hover:bg-gray-800/90 transition-colors"
      >
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-sm font-medium">Демонстрация экрана</span>
        <ExpandIcon />
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'w-full max-w-4xl'} flex flex-col`}
    >
      {/* Header */}
      <div className={`bg-gray-900/90 backdrop-blur-xl ${isFullscreen ? '' : 'rounded-t-2xl'} px-4 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-white text-sm font-medium">Демонстрация экрана</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleMinimize}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title="Свернуть"
          >
            <MinimizeIcon />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title={isFullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>

      {/* Video */}
      <div className={`relative bg-black flex-1 ${isFullscreen ? '' : 'rounded-b-2xl overflow-hidden shadow-2xl'}`}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`${isFullscreen ? 'w-full h-full object-contain' : 'w-full'}`}
        />
      </div>
    </div>
  );
});
