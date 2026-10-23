package dev.norisk.samples.noloader;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

public final class NoLoaderGameProbe implements ClientModInitializer {
    private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(
        Identifier.fromNamespaceAndPath("noloader_game_probe", "general")
    );

    private static final KeyMapping PROBE_KEY = KeyMappingHelper.registerKeyMapping(
        new KeyMapping(
            "key.noloader_game_probe.probe",
            InputConstants.Type.KEYBOARD,
            InputConstants.KEY_O,
            CATEGORY
        )
    );

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (PROBE_KEY.consumeClick()) {
                if (client.player != null) {
                    client.player.sendSystemMessage(
                        Component.literal("NoLoader game mod is running in Minecraft.")
                    );
                }
            }
        });
    }
}
