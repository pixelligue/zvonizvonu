import { memo, ReactNode } from 'react';

interface ControlButtonProps {
  onClick: () => void;
  active: boolean;
  icon: ReactNode;
  color: 'gray' | 'blue' | 'red';
}

export const ControlButton = memo(function ControlButton({
  onClick,
  active,
  icon,
  color
}: ControlButtonProps) {
  const base = "w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg";

  const styles = {
    gray: active ? 'bg-white text-gray-700' : 'bg-white text-gray-400',
    blue: active ? 'bg-[#007AFF] text-white' : 'bg-white text-gray-600',
    red: active ? 'bg-[#FF3B30] text-white' : 'bg-white text-gray-600',
  };

  return (
    <button onClick={onClick} className={`${base} ${styles[color]}`}>
      {icon}
    </button>
  );
});
