import React, { useEffect, useState } from 'react';

export default function SuggestionInput({
  value,
  onChange,
  placeholder,
  suggestions,
  footerLabel = 'Suggestions',
  onSubmit,
  onPick
}) {
  const [inputValue, setInputValue] = useState(value || '');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  const filtered = inputValue
    ? suggestions.filter((s) => s.startsWith(inputValue.toLowerCase()))
    : suggestions;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (onSubmit) onSubmit(inputValue);
      setIsOpen(false);
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handlePick = (next) => {
    if (onPick) onPick(next);
    setInputValue(next);
    setIsOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          className="w-full border text-sm p-1 rounded"
          value={inputValue}
          onChange={(e) => {
            const next = e.target.value;
            setInputValue(next);
            onChange(next);
            if (isFocused) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            setIsOpen(true);
          }}
          onBlur={() => {
            setIsFocused(false);
            setTimeout(() => setIsOpen(false), 100);
          }}
          placeholder={placeholder}
        />
        {isOpen && filtered.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-28 overflow-y-auto rounded border border-gray-200 bg-white shadow-sm text-xs">
            <div className="flex items-center justify-between px-2 py-1 border-b border-gray-100 bg-white sticky top-0">
              <span className="text-[10px] text-gray-400">Suggestions</span>
              <button
                type="button"
                className="text-[10px] text-gray-500 hover:text-gray-700"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>
            {filtered.map((item) => (
              <button
                type="button"
                key={item}
                className="w-full text-left px-2 py-1 hover:bg-gray-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(item);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="text-[10px] text-gray-400">
        {footerLabel}: {suggestions.join(', ')}
      </div>
    </div>
  );
}
