import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader } from "@/components/Loader";
import { Cursor } from "@/components/Cursor";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { SocialProof } from "@/components/SocialProof";
import { Problem } from "@/components/Problem";
import { Transformation } from "@/components/Transformation";
import { FeatureBento } from "@/components/FeatureBento";
import { NotChatbot } from "@/components/NotChatbot";
import { Workflow } from "@/components/Workflow";
import { StudySession } from "@/components/StudySession";
import { Analytics } from "@/components/Analytics";
import { HowItWorks } from "@/components/HowItWorks";
import { Pricing } from "@/components/Pricing";
import { FAQ } from "@/components/FAQ";
import { FinalCTA } from "@/components/FinalCTA";
import { Marquee } from "@/components/Marquee";
import { Footer } from "@/components/Footer";
import { WorkspaceTransition } from "@/components/WorkspaceTransition";

const TITLE = "Judineik AI — Your AI study assistant";
const DESCRIPTION =
  "An AI study assistant that understands your study material, generates summaries, questions and flashcards, and helps you focus on what matters.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Judineik AI",
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          description: DESCRIPTION,
        }),
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [loaded, setLoaded] = useState(false);
  const [workspace, setWorkspace] = useState(false);

  return (
    <>
      <Loader onDone={() => setLoaded(true)} />
      <Cursor />
      <Navbar />
      <main
        className="transition-opacity duration-1000"
        style={{ opacity: loaded ? 1 : 0 }}
      >
        <Hero />
        <SocialProof />
        <Problem />
        <Transformation />
        <FeatureBento />
        <NotChatbot />
        <Workflow />
        <StudySession />
        <Analytics />
        <HowItWorks />
        <Pricing onStart={() => setWorkspace(true)} />
        <FAQ />
        <FinalCTA onStart={() => setWorkspace(true)} />
        <Marquee />
        <Footer />
      </main>
      <WorkspaceTransition open={workspace} onClose={() => setWorkspace(false)} />
    </>
  );
}
