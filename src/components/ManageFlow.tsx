import React, { useState } from 'react';
import { ManageList } from './ManageList.js';
import { ManageActions } from './ManageActions.js';
import type { AccessTokenProvider, InstalledSkillRecord } from '../operations/manage.js';

interface ManageFlowProps {
  onBack: () => void;
  /**
   * Supplies a bearer token for a pinned content URL when updating from an
   * authenticated origin. Omitted for unauthenticated sources.
   */
  getAccessToken?: AccessTokenProvider;
}

type FlowScreen = 'list' | 'actions';

export function ManageFlow({ onBack, getAccessToken }: ManageFlowProps) {
  const [screen, setScreen] = useState<FlowScreen>('list');
  const [selected, setSelected] = useState<InstalledSkillRecord | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  if (screen === 'actions' && selected) {
    return (
      <ManageActions
        record={selected}
        getAccessToken={getAccessToken}
        onBack={() => setScreen('list')}
        onDone={() => {
          setRefreshToken((t) => t + 1);
          setScreen('list');
        }}
      />
    );
  }

  return (
    <ManageList
      refreshToken={refreshToken}
      onSelect={(record) => {
        setSelected(record);
        setScreen('actions');
      }}
      onBack={onBack}
    />
  );
}
