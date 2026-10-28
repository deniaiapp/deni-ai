function buildBarcodePattern(value: string) {
  const bars: number[] = [1.6, 0.7, 1.6, 0.7];
  for (const char of value) {
    const code = char.charCodeAt(0);
    bars.push(
      0.8 + ((code >> 0) & 1) * 0.9,
      0.7,
      0.8 + ((code >> 1) & 1) * 1.1,
      0.6,
      0.8 + ((code >> 2) & 1) * 0.8,
      0.7,
      1.1 + ((code >> 3) & 1) * 0.7,
      0.6,
    );
  }
  bars.push(1.6, 0.7, 1.6);
  return bars;
}

export function ReceiptBarcode({ value }: { value: string }) {
  const bars = buildBarcodePattern(value);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div aria-hidden="true" className="flex h-10 items-stretch justify-center">
        {bars.map((width, index) => (
          <span
            className={index % 2 === 0 ? "bg-[#1a1a1a]" : "bg-transparent"}
            key={`${value}-${index}`}
            style={{ width: `${width * 1.35}px` }}
          />
        ))}
      </div>
      <div className="font-mono text-[9px] tracking-[0.28em] text-[#8a857c] uppercase">{value}</div>
    </div>
  );
}
