interface Props {
  level: number;
  isMuted: boolean;
  light?: boolean;
}

export function MicLevel({ level, isMuted, light = false }: Props) {
  const bars = 5;
  const thresholds = [2, 8, 20, 40, 70];

  return (
    <div className="flex items-end justify-center gap-1 h-10 w-16">
      {Array.from({ length: bars }).map((_, i) => {
        const active = !isMuted && level >= thresholds[i];
        const height = 30 + i * 15;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-colors duration-75 ${
              light
                ? active ? 'bg-white' : 'bg-white/30'
                : active ? 'bg-green-500' : 'bg-gray-300'
            }`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
