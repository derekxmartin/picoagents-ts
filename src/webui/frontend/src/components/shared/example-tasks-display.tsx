import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

interface ExampleTasksDisplayProps {
  tasks: string[];
  onTaskClick: (task: string) => void;
  entityName: string;
}

export const ExampleTasksDisplay: React.FC<ExampleTasksDisplayProps> = ({
  tasks,
  onTaskClick,
  entityName,
}) => {
  if (!tasks || tasks.length === 0) return null;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <Sparkles className="w-12 h-12 mb-4 text-primary" />
      <h3 className="text-xl font-semibold mb-2">Try these example tasks</h3>
      <p className="text-muted-foreground mb-6 text-center">
        Click any example to get started with {entityName}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl w-full">
        {tasks.map((task, index) => (
          <Card
            key={index}
            className="cursor-pointer hover:border-primary hover:shadow-lg transition-all"
            onClick={() => onTaskClick(task)}
          >
            <CardContent className="p-4">
              <p className="text-sm">{task}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
