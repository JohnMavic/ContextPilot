import { memo } from "react";

interface VolumeMeterProps {
  level: number; // 0 to 1
  label?: string;
}

export const VolumeMeter = memo(function VolumeMeter({ level, label }: VolumeMeterProps) {
  // Clamp level between 0 and 1
  const clampedLevel = Math.max(0, Math.min(1, level));
  
  return (
    <div className="volume-meter">
      {label && <span className="volume-label">{label}</span>}
      <div className="volume-bar-container">
        <div 
          className="volume-bar-fill"
          style={{ 
            transform: `scaleX(${clampedLevel})`,
            opacity: clampedLevel > 0.01 ? 1 : 0.3,
          }}
        />
        {/* Tick marks for visual reference */}
        <div className="volume-ticks">
          <span /><span /><span /><span /><span />
        </div>
      </div>
    </div>
  );
});
