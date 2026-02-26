/**
 * AppHeader - Global application header for PicoAgents WebUI
 * Features: Entity selection, global settings, theme toggle
 */

import { Button } from "@/components/ui/button";
import { EntitySelector } from "@/components/shared/entity-selector";
import { ModeToggle } from "@/components/mode-toggle";
import { Settings } from "lucide-react";
import type { Entity } from "@/types";

interface AppHeaderProps {
  entities: Entity[];
  selectedEntity?: Entity;
  onSelect: (entity: Entity) => void;
  isLoading?: boolean;
  onViewGallery?: () => void;
  onDeleteEntity?: (entity: Entity) => void;
}

export function AppHeader({
  entities,
  selectedEntity,
  onSelect,
  isLoading = false,
  onViewGallery,
  onDeleteEntity,
}: AppHeaderProps) {
  return (
    <header className="flex h-14 items-center gap-4 border-b px-4">
      <div className="font-semibold">PicoAgents WebUI</div>
      <EntitySelector
        entities={entities}
        selectedEntity={selectedEntity}
        onSelect={onSelect}
        isLoading={isLoading}
        onViewGallery={onViewGallery}
        onDeleteEntity={onDeleteEntity}
      />

      <div className="flex items-center gap-2 ml-auto">
        <ModeToggle />
        <Button variant="ghost" size="sm">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}