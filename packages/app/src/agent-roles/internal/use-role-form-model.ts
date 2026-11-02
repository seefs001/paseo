import { useEffect, useState, useSyncExternalStore } from "react";
import {
  openAgentRoleForm,
  type AgentRoleFormModel,
  type AgentRoleFormSnapshot,
  type AgentRoleFormState,
} from "./role-form-model";

/** One model per mount; the modal keys its body on mode + role id. */
export function useAgentRoleFormModel(snapshot: AgentRoleFormSnapshot): AgentRoleFormModel {
  const [model] = useState(() => openAgentRoleForm(snapshot));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  return model;
}

export function useAgentRoleFormState(model: AgentRoleFormModel): AgentRoleFormState {
  return useSyncExternalStore(model.subscribe, model.getState, model.getState);
}
