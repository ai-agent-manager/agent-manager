// Vendored from ink-select-input@6.2.0 (MIT, Copyright (c) Vadym Demedes).
// Kept in-tree so every React consumer resolves the CLI's own react/ink copy;
// see src/components/ink/README.md.
import { isDeepStrictEqual } from 'node:util';
import React, { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { Box, Text, useInput } from 'ink';
import figures from 'figures';

export type IndicatorProps = {
  readonly isSelected?: boolean;
};

export type ItemProps = {
  readonly isSelected?: boolean;
  readonly label: string;
};

export type Item<V> = {
  key?: string;
  label: string;
  value: V;
};

type Props<V> = {
  readonly items?: Array<Item<V>>;
  readonly isFocused?: boolean;
  readonly initialIndex?: number;
  readonly limit?: number;
  readonly indicatorComponent?: FC<IndicatorProps>;
  readonly itemComponent?: FC<ItemProps>;
  readonly onSelect?: (item: Item<V>) => void;
  readonly onHighlight?: (item: Item<V>) => void;
};

export function Indicator({ isSelected = false }: IndicatorProps) {
  return (
    <Box marginRight={1}>
      {isSelected ? <Text color="blue">{figures.pointer}</Text> : <Text> </Text>}
    </Box>
  );
}

export function ItemComponent({ isSelected = false, label }: ItemProps) {
  return <Text color={isSelected ? 'blue' : undefined}>{label}</Text>;
}

function toRotated<T>(array: T[], steps: number): T[] {
  const { length } = array;
  if (length === 0) return [...array];
  const normalizedSteps = ((steps % length) + length) % length;
  if (normalizedSteps === 0) return [...array];
  return [...array.slice(-normalizedSteps), ...array.slice(0, -normalizedSteps)];
}

export default function SelectInput<V>({
  items = [],
  isFocused = true,
  initialIndex = 0,
  indicatorComponent = Indicator,
  itemComponent = ItemComponent,
  limit: customLimit,
  onSelect,
  onHighlight,
}: Props<V>) {
  const hasLimit = typeof customLimit === 'number' && items.length > customLimit;
  const limit = hasLimit ? Math.min(customLimit, items.length) : items.length;
  const lastIndex = limit - 1;
  const [rotateIndex, setRotateIndex] = useState(initialIndex > lastIndex ? lastIndex - initialIndex : 0);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex ? (initialIndex > lastIndex ? lastIndex : initialIndex) : 0);
  const previousItems = useRef(items);

  useEffect(() => {
    if (!isDeepStrictEqual(previousItems.current.map((item) => item.value), items.map((item) => item.value))) {
      setRotateIndex(0);
      setSelectedIndex(0);
    }
    previousItems.current = items;
  }, [items]);

  useInput(
    useCallback(
      (input, key) => {
        if (input === 'k' || key.upArrow) {
          const lastIndex = (hasLimit ? limit : items.length) - 1;
          const atFirstIndex = selectedIndex === 0;
          const nextIndex = hasLimit ? selectedIndex : lastIndex;
          const nextRotateIndex = atFirstIndex ? rotateIndex + 1 : rotateIndex;
          const nextSelectedIndex = atFirstIndex ? nextIndex : selectedIndex - 1;
          setRotateIndex(nextRotateIndex);
          setSelectedIndex(nextSelectedIndex);
          const slicedItems = hasLimit ? toRotated(items, nextRotateIndex).slice(0, limit) : items;
          if (typeof onHighlight === 'function') {
            onHighlight(slicedItems[nextSelectedIndex]);
          }
        }

        if (input === 'j' || key.downArrow) {
          const atLastIndex = selectedIndex === (hasLimit ? limit : items.length) - 1;
          const nextIndex = hasLimit ? selectedIndex : 0;
          const nextRotateIndex = atLastIndex ? rotateIndex - 1 : rotateIndex;
          const nextSelectedIndex = atLastIndex ? nextIndex : selectedIndex + 1;
          setRotateIndex(nextRotateIndex);
          setSelectedIndex(nextSelectedIndex);
          const slicedItems = hasLimit ? toRotated(items, nextRotateIndex).slice(0, limit) : items;
          if (typeof onHighlight === 'function') {
            onHighlight(slicedItems[nextSelectedIndex]);
          }
        }

        if (/^[1-9]$/.test(input)) {
          const targetIndex = Number.parseInt(input, 10) - 1;
          const visibleItems = hasLimit ? toRotated(items, rotateIndex).slice(0, limit) : items;
          if (targetIndex >= 0 && targetIndex < visibleItems.length) {
            const selectedItem = visibleItems[targetIndex];
            if (selectedItem) {
              onSelect?.(selectedItem);
            }
          }
        }

        if (key.return) {
          const slicedItems = hasLimit ? toRotated(items, rotateIndex).slice(0, limit) : items;
          if (typeof onSelect === 'function') {
            onSelect(slicedItems[selectedIndex]);
          }
        }
      },
      [hasLimit, limit, rotateIndex, selectedIndex, items, onSelect, onHighlight],
    ),
    { isActive: isFocused },
  );

  const slicedItems = hasLimit ? toRotated(items, rotateIndex).slice(0, limit) : items;

  return (
    <Box flexDirection="column">
      {slicedItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={item.key ?? String(item.value)}>
            {React.createElement(indicatorComponent, { isSelected })}
            {React.createElement(itemComponent, { ...item, isSelected })}
          </Box>
        );
      })}
    </Box>
  );
}
