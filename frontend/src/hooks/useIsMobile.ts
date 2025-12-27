import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Проверяем user agent и размер экрана
      const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      const screenMobile = window.innerWidth < 768;

      // Также проверяем поддержку getDisplayMedia
      const hasScreenShare = 'getDisplayMedia' in (navigator.mediaDevices || {});

      setIsMobile(userAgentMobile || screenMobile || !hasScreenShare);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}
