import { useState } from "react";

import { TabbedPanel } from "../../../components/ui/TabbedPanel";
import { PythonRuntimeFooter } from "../../python-runtime/components/PythonRuntimeFooter";
import type { DesktopModelsClient } from "../api/desktopModelsClient";
import { useModelsFeature } from "../hooks/useModelsFeature";
import { useModelTrainingFeature } from "../hooks/useModelTrainingFeature";
import { BrowseModelsTab } from "./BrowseModelsTab";
import { ManageModelsTab } from "./ManageModelsTab";
import { TrainModelTab } from "./TrainModelTab";

export function ModelsFeature(props: {
  client?: DesktopModelsClient;
  workspaceId?: string;
  workspaceName?: string;
}) {
  const state = useModelsFeature(props.client, props.workspaceId);
  const [activeTabId, setActiveTabId] = useState("browse-models");
  const handleTabChange = (tabId: string) => {
    setActiveTabId(tabId);
    if (tabId === "manage-models") {
      void state.refreshModels();
    }
  };
  return (
    <section className="models-feature ui-stack ui-stack--sm">
      <TabbedPanel
        tabListAriaLabel="Model workspace panels"
        defaultTabId="browse-models"
        onTabChange={handleTabChange}
        tabs={[
          {
            id: "browse-models",
            label: "Find Models",
            content: <BrowseModelsTab state={state} />,
          },
          {
            id: "manage-models",
            label: "Manage Models",
            content: <ManageModelsTab state={state} />,
          },
          {
            id: "train-model",
            label: "Train Model",
            content: (
              <DeferredTrainModelTab
                client={props.client}
                workspaceId={props.workspaceId}
              />
            ),
          },
        ]}
      />
      <PythonRuntimeFooter enabled={activeTabId === "train-model"} />
    </section>
  );
}

function DeferredTrainModelTab({
  client,
  workspaceId,
}: {
  client?: DesktopModelsClient;
  workspaceId?: string;
}) {
  const trainingState = useModelTrainingFeature(client, workspaceId);
  return <TrainModelTab state={trainingState} />;
}
