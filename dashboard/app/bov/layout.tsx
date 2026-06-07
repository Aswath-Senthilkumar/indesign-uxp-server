import { BovStateProvider } from "@/lib/bov-state";
import BovStepper from "@/components/bov-stepper";

export default function BovLayout({ children }: { children: React.ReactNode }) {
    return (
        <BovStateProvider>
            <BovStepper />
            {children}
        </BovStateProvider>
    );
}
