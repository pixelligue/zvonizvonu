import { memo } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
}

export const Toggle = memo(function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      onClick={onChange}
      className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-[#34C759]' : 'bg-gray-300'}`}
    >
      <div
        className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  );
});
