"use client";

export function DotLoader() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0">
      <style>{`
        .d { fill: #e0e0e8; }
        .d1 { animation: vis 1.6s -1.6s infinite; }
        .d2 { animation: vis 1.6s -1.4s infinite; }
        .d3 { animation: vis 1.6s -1.2s infinite; }
        .d4 { animation: vis 1.6s -1.0s infinite; }
        .d5 { animation: vis 1.6s -0.8s infinite; }
        .d6 { animation: vis 1.6s -0.6s infinite; }
        .d7 { animation: vis 1.6s -0.4s infinite; }
        .d8 { animation: vis 1.6s -0.2s infinite; }
        @keyframes vis {
          0%, 100% { opacity: 0; }
          15%, 35% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      <rect className="d d1" x="1"  y="1"  width="4" height="4" rx="0.5" />
      <rect className="d d2" x="10" y="1"  width="4" height="4" rx="0.5" />
      <rect className="d d3" x="19" y="1"  width="4" height="4" rx="0.5" />
      <rect className="d d4" x="19" y="10" width="4" height="4" rx="0.5" />
      <rect className="d d5" x="19" y="19" width="4" height="4" rx="0.5" />
      <rect className="d d6" x="10" y="19" width="4" height="4" rx="0.5" />
      <rect className="d d7" x="1"  y="19" width="4" height="4" rx="0.5" />
      <rect className="d d8" x="1"  y="10" width="4" height="4" rx="0.5" />
    </svg>
  );
}
