(function () {
    "use strict";

    let mounted = null;

    /**
     * Mount onto a root containing existing panels. steps: [{ id, title, panel }].
     * validate(index) returns true or { ok: false, focus: Element }; onChange(index)
     * runs after a transition (not on mount). initialStep is a zero-based saved step.
     * Panels are only hidden/shown, never replaced. An optional
     * [data-checkout-steps-submit] inside the last panel places Back before its CTA.
     * goTo(index) returns false when validation blocks advancement; current() is -1
     * before mount. Re-mounting removes the previous stepper's controls/listener.
     */
    function mount(root, { steps, initialStep = 0, validate = () => true, onChange = () => {} } = {}) {
        if (!root || !Array.isArray(steps) || !steps.length || steps.some((step) => !step.panel || !step.id || !step.title)) {
            throw new TypeError("CheckoutSteps.mount cần root và danh sách bước có id, title, panel.");
        }
        if (mounted) {
            mounted.root.removeEventListener("keydown", mounted.preventImplicitSubmit);
            mounted.progress.remove();
            mounted.actions.forEach((actions) => actions.remove());
        }

        const progress = document.createElement("ol");
        progress.className = "checkout-steps__progress";
        progress.setAttribute("aria-label", "Các bước thanh toán");
        const buttons = [];
        const markers = [];
        const actions = [];
        const headings = [];

        steps.forEach((step, index) => {
            const panel = step.panel;
            panel.classList.add("checkout-steps__panel");
            if (!panel.id) panel.id = step.id;
            let heading = panel.querySelector("h2, h3, [data-checkout-step-title]");
            if (!heading) {
                heading = document.createElement("h2");
                heading.className = "checkout-section-title";
                heading.textContent = step.title;
                panel.prepend(heading);
            }
            if (!heading.id) heading.id = `${step.id}-title`;
            heading.setAttribute("tabindex", "-1");
            panel.setAttribute("aria-labelledby", heading.id);
            headings.push(heading);

            const item = document.createElement("li");
            item.className = "checkout-steps__item";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "checkout-steps__step";
            button.setAttribute("aria-controls", panel.id);
            const marker = document.createElement("span");
            marker.className = "checkout-steps__marker";
            marker.setAttribute("aria-hidden", "true");
            const label = document.createElement("span");
            label.className = "checkout-steps__label";
            label.textContent = step.title;
            button.append(marker, label);
            button.addEventListener("click", () => goTo(index));
            item.append(button);
            progress.append(item);
            buttons.push(button);
            markers.push(marker);

            const navigation = document.createElement("div");
            navigation.className = "checkout-steps__actions";
            if (index > 0) {
                const back = document.createElement("button");
                back.type = "button";
                back.className = "btn btn--secondary checkout-steps__back";
                back.textContent = "Quay lại";
                back.addEventListener("click", () => goTo(index - 1));
                navigation.append(back);
            }
            if (index < steps.length - 1) {
                const next = document.createElement("button");
                next.type = "button";
                next.className = "btn btn--primary checkout-steps__next";
                next.textContent = "Tiếp tục";
                next.addEventListener("click", (event) => {
                    if (event.detail > 1) return;
                    goTo(index + 1);
                });
                navigation.append(next);
            }
            const submit = index === steps.length - 1 ? panel.querySelector("[data-checkout-steps-submit]") : null;
            if (submit) submit.parentNode.insertBefore(navigation, submit);
            else panel.append(navigation);
            actions.push(navigation);
        });

        steps[0].panel.parentNode.insertBefore(progress, steps[0].panel);
        const preventImplicitSubmit = (event) => {
            if (event.key !== "Enter" || event.isComposing || !event.target.matches?.("input:not([type=button]):not([type=submit]):not([type=reset])")) return;
            const form = event.target.closest("form");
            if (!form || form === root) event.preventDefault();
        };
        root.addEventListener("keydown", preventImplicitSubmit);
        mounted = {
            root, steps, validate, onChange, progress, buttons, markers, headings, actions,
            preventImplicitSubmit, index: -1
        };
        const start = Number.isInteger(initialStep) && initialStep >= 0 && initialStep < steps.length ? initialStep : 0;
        showStep(start, false);
    }

    function showStep(index, focus) {
        const state = mounted;
        state.index = index;
        state.steps.forEach(({ panel }, position) => {
            panel.hidden = position !== index;
            const item = state.buttons[position].parentNode;
            const button = state.buttons[position];
            item.classList.toggle("is-complete", position < index);
            item.classList.toggle("is-current", position === index);
            if (position === index) item.setAttribute("aria-current", "step");
            else item.removeAttribute("aria-current");
            button.disabled = position >= index;
            state.markers[position].textContent = position < index ? "✓" : String(position + 1);
        });
        if (focus) {
            state.headings[index].focus();
            state.onChange(index);
        }
    }

    function goTo(index) {
        const state = mounted;
        if (!state || !Number.isInteger(index) || index < 0 || index >= state.steps.length) return false;
        if (index === state.index) return true;
        for (let step = state.index; step < index; step++) {
            const result = state.validate(step);
            if (result !== true) {
                if (step !== state.index) showStep(step, true);
                result?.focus?.focus();
                return false;
            }
        }
        showStep(index, true);
        return true;
    }

    window.CheckoutSteps = { mount, goTo, current: () => mounted ? mounted.index : -1 };
}());
