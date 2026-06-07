import { notFound } from "next/navigation";
import { getBovStep, isValidBovStep } from "@/lib/bov-steps";
import BovStepView from "@/components/bov-step-view";

export default async function BovStepPage({
    params,
}: {
    params: Promise<{ step: string }>;
}) {
    const { step } = await params;
    const stepNum = parseInt(step, 10);

    if (!isValidBovStep(stepNum)) notFound();

    const meta = getBovStep(stepNum);
    if (!meta) notFound();

    return <BovStepView meta={meta} />;
}
