import type React from "react";
import { Card } from "@/components/ui/Card";
import type { Feature } from "@/content/types";
import { FeatureBody } from "@/features/features/components/FeatureBody";

interface FeatureCardProps {
  feature: Feature;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({ feature }) => (
  <Card className="p-6">
    <FeatureBody feature={feature} />
  </Card>
);
