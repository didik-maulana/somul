import type React from "react";
import { DownloadSection } from "@/features/download/components/DownloadSection";
import { FaqSection } from "@/features/faq/components/FaqSection";
import { FeatureGrid } from "@/features/features/components/FeatureGrid";
import { Hero } from "@/features/hero/components/Hero";
import { HowItWorks } from "@/features/how/components/HowItWorks";
import { PrivacySection } from "@/features/privacy/components/PrivacySection";
import { MixerShowcase } from "@/features/showcase/components/MixerShowcase";

const HomePage: React.FC = () => (
  <>
    <Hero />
    <MixerShowcase />
    <FeatureGrid />
    <HowItWorks />
    <PrivacySection />
    <FaqSection />
    <DownloadSection />
  </>
);

export default HomePage;
