import React, { useState } from 'react';
import { ManageList } from './ManageList.js';
import { ManageActions } from './ManageActions.js';
import type { InstalledSkillRecord } from '../operations/manage.js';
import type { InteractiveAccessTokenProvider } from '../auth/access-token-provider.js';

interface ManageFlowProps {
  onBack: () => void;
  getAccessToken?: InteractiveAccessTokenProvider;
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
