import { useEffect, useState } from "react";
import { openCustomCommandForm, type CustomCommandFormSnapshot } from "./form-model";

export function useCustomCommandFormModel(snapshot: CustomCommandFormSnapshot) {
  const [model] = useState(() => openCustomCommandForm(snapshot));
  useEffect(() => () => model.close(), [model]);
  useEffect(() => {
    model.applyCommands(snapshot.commands);
  }, [model, snapshot.commands]);
  return model;
}
