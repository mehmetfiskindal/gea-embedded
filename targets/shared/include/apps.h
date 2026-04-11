#pragma once

int gea_embedded_apps_launch(const char *app_id);
int gea_embedded_apps_return_to_launcher_on_reset(void);
void gea_embedded_apps_start_launcher_button_task(void);
const char *gea_embedded_apps_get_current_id(void);
