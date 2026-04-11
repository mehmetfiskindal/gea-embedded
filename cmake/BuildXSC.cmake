set(_BUILD_XSC_DIR "${CMAKE_CURRENT_LIST_DIR}/..")
cmake_path(ABSOLUTE_PATH _BUILD_XSC_DIR NORMALIZE)
set(XS_DIR "${_BUILD_XSC_DIR}/vendor/xs")

set(XSC_SOURCES
    ${XS_DIR}/sources/xsBigInt.c
    ${XS_DIR}/sources/xsCode.c
    ${XS_DIR}/sources/xsCommon.c
    ${XS_DIR}/sources/xsdtoa.c
    ${XS_DIR}/sources/xsLexical.c
    ${XS_DIR}/sources/xsre.c
    ${XS_DIR}/sources/xsScope.c
    ${XS_DIR}/sources/xsScript.c
    ${XS_DIR}/sources/xsSourceMap.c
    ${XS_DIR}/sources/xsSyntaxical.c
    ${XS_DIR}/sources/xsTree.c
    ${XS_DIR}/tools/xsc.c
)

set(XSC_INCLUDES
    ${XS_DIR}/includes
    ${XS_DIR}/platforms
    ${XS_DIR}/sources
    ${XS_DIR}/tools
)

set(XSC_BUILD_DIR "${CMAKE_BINARY_DIR}/host_tools")
set(XSC_BINARY "${XSC_BUILD_DIR}/xsc")

if(NOT TARGET host_xsc)
    file(MAKE_DIRECTORY ${XSC_BUILD_DIR})

    set(_xsc_include_flags "")
    foreach(_dir ${XSC_INCLUDES})
        list(APPEND _xsc_include_flags "-I${_dir}")
    endforeach()

    add_custom_command(
        OUTPUT ${XSC_BINARY}
        COMMAND cc -O2 -DmxCompile=1
                ${_xsc_include_flags}
                ${XSC_SOURCES}
                -lm -o ${XSC_BINARY}
        DEPENDS ${XSC_SOURCES}
        COMMENT "Building host xsc compiler"
        VERBATIM
    )

    add_custom_target(host_xsc DEPENDS ${XSC_BINARY})
endif()
