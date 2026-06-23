# Locate QuickJS + qjsc compiler
#
# Options:
#   QUICKJS_DIR — path to a QuickJS source tree (containing quickjs.c, quickjs.h)
#   QUICKJS_USE_SUBMODULE=ON — use ${GEA_EMBEDDED_ROOT}/vendor/quickjs
#
# Defines:
#   QUICKJS_FOUND
#   QUICKJS_INCLUDE_DIRS
#   QUICKJS_SOURCES     — list of .c files to compile into the target
#   QUICKJS_LIBRARIES   — link flags (empty; we compile sources directly)
#   QJSC_BINARY         — path to host qjsc tool (used at build time)

include(FindPackageHandleStandardArgs)

set(QUICKJS_DIR "" CACHE PATH "Path to QuickJS source tree (with quickjs.h)")

if(QUICKJS_DIR STREQUAL "" AND DEFINED GEA_EMBEDDED_ROOT)
    if(EXISTS "${GEA_EMBEDDED_ROOT}/vendor/quickjs/quickjs.h")
        set(QUICKJS_DIR "${GEA_EMBEDDED_ROOT}/vendor/quickjs")
    endif()
endif()

if(QUICKJS_DIR STREQUAL "")
    find_path(QUICKJS_INCLUDE_DIR
        NAMES quickjs/quickjs.h
        PATHS /usr/include /usr/local/include
    )
    if(QUICKJS_INCLUDE_DIR)
        get_filename_component(QUICKJS_DIR "${QUICKJS_INCLUDE_DIR}" DIRECTORY)
    endif()
endif()

if(QUICKJS_DIR AND EXISTS "${QUICKJS_DIR}/quickjs.h")
    set(QUICKJS_FOUND TRUE)
    set(QUICKJS_INCLUDE_DIRS "${QUICKJS_DIR}")
    set(QUICKJS_SOURCES
        "${QUICKJS_DIR}/quickjs.c"
        "${QUICKJS_DIR}/quickjs-libc.c"
        "${QUICKJS_DIR}/cutils.c"
        "${QUICKJS_DIR}/libregexp.c"
        "${QUICKJS_DIR}/libunicode.c"
    )
    # Host qjsc tool (compiled on build host, not target)
    if(NOT QJSC_BINARY)
        find_program(QJSC_BINARY qjsc
            PATHS ${QUICKJS_DIR} /usr/bin /usr/local/bin
        )
    endif()
else()
    set(QUICKJS_FOUND FALSE)
endif()

find_package_handle_standard_args(QuickJS
    DEFAULT_MSG QUICKJS_DIR
)

mark_as_advanced(QUICKJS_DIR)
