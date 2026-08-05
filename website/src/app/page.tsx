import type React from "react";
import { DownloadSection } from "@/features/download/components/DownloadSection";
import { FeatureGrid } from "@/features/features/components/FeatureGrid";
import { Hero } from "@/features/hero/components/Hero";
import { HowItWorks } from "@/features/how/components/HowItWorks";
import { PlatformTable } from "@/features/platforms/components/PlatformTable";
import { PrivacySection } from "@/features/privacy/components/PrivacySection";
import { MixerShowcase } from "@/features/showcase/components/MixerShowcase";

const HomePage: React.FC = () => (
  <>
    <Hero />
    <MixerShowcase />
    <FeatureGrid />
    <HowItWorks />
    <PlatformTable />
    <PrivacySection />
    <DownloadSection />
  </>
);

export default HomePage;
