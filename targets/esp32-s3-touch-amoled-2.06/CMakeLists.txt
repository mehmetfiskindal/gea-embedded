cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS "")
set(GEA_EMBEDDED_APP "tic-tac-toe" CACHE STRING "Example app to build (must match an id in examples/apps.json)")
set(PROJECT_VER "${GEA_EMBEDDED_APP}" CACHE STRING "Firmware app id" FORCE)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(gea_embedded)
