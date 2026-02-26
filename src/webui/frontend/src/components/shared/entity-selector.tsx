/**
 * EntitySelector - High-quality dropdown for selecting agents/orchestrators/workflows
 * Features: Type indicators, metadata display, keyboard navigation, grouping
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  ChevronDown,
  Bot,
  Workflow,
  FolderOpen,
  Database,
  Users,
  Settings,
  Library,
  Trash2
} from "lucide-react";
import type { Entity, AgentInfo, OrchestratorInfo, WorkflowInfo } from "@/types";

interface EntitySelectorProps {
  entities: Entity[];
  selectedEntity?: Entity;
  onSelect: (entity: Entity) => void;
  isLoading?: boolean;
  onViewGallery?: () => void;
  onDeleteEntity?: (entity: Entity) => void;
}

const getTypeIcon = (type: "agent" | "orchestrator" | "workflow") => {
  switch (type) {
    case "agent":
      return Bot;
    case "orchestrator":
      return Users;
    case "workflow":
      return Workflow;
    default:
      return Settings;
  }
};

const getSourceIcon = (source: string) => {
  return source === "directory" ? FolderOpen : Database;
};

const getEntityMetadata = (entity: Entity) => {
  switch (entity.type) {
    case "agent":
      const agent = entity as AgentInfo;
      return {
        count: agent.tools.length,
        label: "tools",
        secondaryInfo: agent.model ? `Model: ${agent.model}` : undefined
      };
    case "orchestrator":
      const orchestrator = entity as OrchestratorInfo;
      return {
        count: orchestrator.agents.length,
        label: "agents",
        secondaryInfo: `Type: ${orchestrator.orchestratorType}`
      };
    case "workflow":
      const workflow = entity as WorkflowInfo;
      return {
        count: workflow.steps.length,
        label: "steps",
        secondaryInfo: workflow.startStep ? `Start: ${workflow.startStep}` : undefined
      };
    default:
      return { count: 0, label: "items" };
  }
};

export function EntitySelector({
  entities,
  selectedEntity,
  onSelect,
  isLoading = false,
  onViewGallery,
  onDeleteEntity,
}: EntitySelectorProps) {
  const [open, setOpen] = useState(false);

  // Group entities by type
  const agents = entities.filter((e): e is AgentInfo => e.type === "agent");
  const orchestrators = entities.filter((e): e is OrchestratorInfo => e.type === "orchestrator");
  const workflows = entities.filter((e): e is WorkflowInfo => e.type === "workflow");

  const handleSelect = (entity: Entity) => {
    onSelect(entity);
    setOpen(false);
  };

  const TypeIcon = selectedEntity ? getTypeIcon(selectedEntity.type) : Bot;
  const displayName = selectedEntity?.name || selectedEntity?.id || "Select...";
  const metadata = selectedEntity ? getEntityMetadata(selectedEntity) : null;

  const handleDelete = (entity: Entity, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent dropdown item click
    if (onDeleteEntity) {
      onDeleteEntity(entity);
    }
  };

  const renderEntityItem = (entity: Entity) => {
    const EntityIcon = getTypeIcon(entity.type);
    const SourceIcon = getSourceIcon(entity.source);
    const entityMetadata = getEntityMetadata(entity);
    const canDelete = entity.source === "github" || entity.source === "memory";

    return (
      <DropdownMenuItem
        key={entity.id}
        onClick={() => handleSelect(entity)}
        className="cursor-pointer"
      >
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <EntityIcon className="h-4 w-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {entity.name || entity.id}
              </div>
              {entity.description && (
                <div className="text-xs text-muted-foreground truncate">
                  {entity.description}
                </div>
              )}
              {entityMetadata.secondaryInfo && (
                <div className="text-xs text-muted-foreground truncate">
                  {entityMetadata.secondaryInfo}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <SourceIcon className="h-3 w-3 opacity-60" />
            <Badge variant="outline" className="text-xs">
              {entityMetadata.count}
            </Badge>
            {canDelete && onDeleteEntity && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                onClick={(e) => handleDelete(entity, e)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-64 justify-between font-mono text-sm"
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <LoadingSpinner size="sm" />
              <span className="text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <TypeIcon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{displayName}</span>
                {selectedEntity && metadata && (
                  <Badge variant="secondary" className="ml-auto flex-shrink-0">
                    {metadata.count} {metadata.label}
                  </Badge>
                )}
              </div>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-80 font-mono">
        {/* Agents Section */}
        {agents.length > 0 && (
          <>
            <DropdownMenuLabel className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Agents ({agents.length})
            </DropdownMenuLabel>
            {agents.map(renderEntityItem)}
          </>
        )}

        {/* Orchestrators Section */}
        {orchestrators.length > 0 && (
          <>
            {agents.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Orchestrators ({orchestrators.length})
            </DropdownMenuLabel>
            {orchestrators.map(renderEntityItem)}
          </>
        )}

        {/* Workflows Section */}
        {workflows.length > 0 && (
          <>
            {(agents.length > 0 || orchestrators.length > 0) && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              Workflows ({workflows.length})
            </DropdownMenuLabel>
            {workflows.map(renderEntityItem)}
          </>
        )}

        {/* Empty State */}
        {entities.length === 0 && !onViewGallery && (
          <DropdownMenuItem disabled>
            <div className="text-center text-muted-foreground py-2">
              {isLoading ? "Loading..." : "No agents, orchestrators, or workflows found"}
            </div>
          </DropdownMenuItem>
        )}

        {/* View Gallery Button */}
        {onViewGallery && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                onViewGallery();
                setOpen(false);
              }}
              className="cursor-pointer"
            >
              <div className="flex items-center gap-2 w-full text-primary">
                <Library className="h-4 w-4" />
                <span className="font-medium">Browse Examples Gallery</span>
              </div>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}