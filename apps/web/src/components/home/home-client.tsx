import { LazyMotion, domAnimation } from "motion/react";
import { HomeFeaturesSection } from "./home-features-section";
import { HomeHeroSection } from "./home-hero-section";
import { HomeTrustSection } from "./home-trust-section";

export function ClientHome() {
  return (
    <LazyMotion features={domAnimation} strict>
      <main className="relative min-h-screen overflow-hidden" id="main-content">
        <HomeHeroSection />
        <HomeFeaturesSection />
        <HomeTrustSection />
      </main>
    </LazyMotion>
  );
}
